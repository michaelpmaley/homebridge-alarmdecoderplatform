var http = require('http');
var request = require("request");
var waitUntil = require('wait-until');
var Accessory, Service, Characteristic, UUIDGen;


/**
 * Homebridge AlarmDecoder platform module.
 * @module homebridge-alarmdecoderplatform
 * @see module:homebridge-alarmdecoderplatform
 *
 * A platform plugin registers itself via registerPlatform(pluginName, platformName, constructor, dynamic).
 * On the first instantiation, it adds multiple accessories via registerPlatformAccessories(pluginName, platformName, [accessory]).
 * On subsequent instantiations, cached accessories are reloaded via configureAccessory callback.
 *
 * For this plugin,
 * - AlarmDecoder notifications are handled in requestHandler.
 * - HomeKit SecuritySystem accessory get/set requests are handled in getPanelCurrentState/setPanelTargetState.
 * - The "zone" state is only changed via AlarmDecoder notifications, i.e. no overriding getCharacteristic in order to query for current state.
 * - SPECIAL: Smoke sensors are handled as regular zones, additionally on a "There is a fire!" message all smoke sensors are faulted and on a disarm all are reset.
 */
module.exports = function(homebridge) {
   console.log("Homebridge API version: " + homebridge.version);

   Accessory = homebridge.platformAccessory;
   Service = homebridge.hap.Service;
   Characteristic = homebridge.hap.Characteristic;
   UUIDGen = homebridge.hap.uuid;
   // put custom characteristics here

   homebridge.registerPlatform("homebridge-alarmdecoderplatform", "AlarmDecoderPlatform", AlarmDecoderPlatform, false);
}


/**
 * Represents the AlarmDecoder Homebridge plugin platform.
 * @constructor
 * @param {object} log - The Homebridge platform logging instance.
 * @param {object} config - The JSON configuration data from the config.json section.
 * @param {object} api - The Homebridge api instance.
 */
function AlarmDecoderPlatform(log, config, api) {
   this.log = log;
   this.config = config;
   this.api = api;
   this.accessories = [];   // holds live accessory instances

   this.log("AlarmDecoderPlatform");
   if (config == null) {
      this.log.error("Failed: config parameter is null");
      this.disabled = true;
      return;
   }
   if (api == null) {
      this.log.error("Failed: api parameter is null");
      this.disabled = true;
      return;
   }

   // load accessories (Homebridge finished loading cached accessories; plugin should only register *new* accessories)
   this.api.on('didFinishLaunching', function() {
      //this.log("Homebridge DidFinishLaunching");
      this.addPanel();
      this.addZones();
   }.bind(this));

   // create notification listener
   this.server = http.createServer(this.requestHandler.bind(this)).listen(this.config.port, function(error) {
      if (error != null) {
         this.log.warn("AlarmDecoderPlatform request handler is not listening")
         return;
      } else {
         this.log("AlarmDecoderPlatform is listening on %s", this.config.port);
      }
   }.bind(this));
}


/**
 * Homebridge callback for restoring cached accessories.
 * @param {object} accessory - The accessory instance to load.
 */
AlarmDecoderPlatform.prototype.configureAccessory = function(accessory) {
   this.log("ConfigureAccessory: %s, %s, %s", accessory.context.id, accessory.displayName, accessory.UUID);

   accessory.updateReachability(true);
   accessory.on('identify', function(paired, callback) {
      this.log("Identify %s", accessory.displayName);
      callback();
   }.bind(this));

   // panel: rebind characteristics to local functions and sync state
   if (accessory.context.type === "panel") {
      var service = accessory.getService(Service.SecuritySystem);
      service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
         .on('get', this.getPanelCurrentState.bind(this));
      service.getCharacteristic(Characteristic.SecuritySystemTargetState)
         .on('get', this.getPanelCurrentState.bind(this))  // just reuse function since they do the same thing
         .on('set', this.setPanelTargetState.bind(this));

      this.accessories.push(accessory);
      this.syncPanelState(function(error){}.bind(this));

   // contact sensor:
   } else if (accessory.context.type === "contact") {
      this.accessories.push(accessory);

   // motion sensor:
   } else if (accessory.context.type === "motion") {
      this.accessories.push(accessory);

   // co sensor:
   } else if (accessory.context.type === "co") {
      this.accessories.push(accessory);

   // smoke sensor:
   } else if (accessory.context.type === "smoke") {
      this.accessories.push(accessory);

   // unknown
   } else {
      this.log.warn("Zone %s has an unknown type %s", accessory.context.id, accessory.context.type);
   }
}


/**
 * Helper function to add a new panel accessory.
 */
AlarmDecoderPlatform.prototype.addPanel = function() {
   this.log("AddPanel");

   if (this.config.panel == null) {
      this.log.warn("Skipping adding alarm system panel");
      return;
   }

   var name = this.config.panel.name;
   var manufacturer = this.config.panel.manufacturer;
   var model = this.config.panel.model;
   var serialnumber = this.config.panel.serialnumber;
   var firmware = this.config.panel.firmware;
   var uuid = UUIDGen.generate(name + manufacturer + model + serialnumber);
   //this.log.debug("found panel %s, %s, %s, %s, %s, %s", name, manufacturer, model, serialnumber, firmware, uuid);

   // if the accessory was loaded from the cache, then skip
   var accessory = this.accessories.find(function(x) { return x.context.type === "panel"; });
   if (accessory) {
      this.log("Panel already exists");
      return;
   }

   // create new accessory
   accessory = new Accessory(name, uuid);
   accessory.updateReachability(true);
   accessory.on('identify', function(paired, callback) {
      this.log("Identify %s", accessory.displayName);
      callback();
   }.bind(this));

   // set context so that we can find it in the array later
   accessory.context = {"id": "0", "type": "panel", "name": name};

   // replace Service.AccessoryInformation information (homebridge.platformAccessory constructor adds this but doesn't set all fields)
   accessory.getService(Service.AccessoryInformation)
      .setCharacteristic(Characteristic.Name, name)
      .setCharacteristic(Characteristic.Manufacturer, manufacturer)
      .setCharacteristic(Characteristic.Model, model)
      .setCharacteristic(Characteristic.SerialNumber, serialnumber)
      .setCharacteristic(Characteristic.FirmwareRevision, firmware);

   // add Service.SecuritySystem and bind characteristics to local functions
   var service = accessory.addService(Service.SecuritySystem);
   service.getCharacteristic(Characteristic.SecuritySystemCurrentState)
      .on('get', this.getPanelCurrentState.bind(this));
   service.getCharacteristic(Characteristic.SecuritySystemTargetState)
      .on('get', this.getPanelCurrentState.bind(this))  // just reuse function since they do the same thing
      .on('set', this.setPanelTargetState.bind(this));

   // push instance into the array and sync state
   this.accessories.push(accessory);
   this.syncPanelState(function(error){}.bind(this));

   // register it with homebridge
   this.api.registerPlatformAccessories("homebridge-alarmdecoderplatform", "AlarmDecoderPlatform", [accessory]);
   this.log("new panel accessory = %s", name);
}


/**
 * Helper function to add a new zone.
 */
AlarmDecoderPlatform.prototype.addZones = function() {
  this.log("AddZones");

   if (this.config.zones == null) {
      this.log.warn("Skipping adding alarm system zones");
      return;
   }

   var zones = this.config.zones;
   zones.forEach(function(zone) {
      var id = zone.id;
      var type = zone.type;
      var name = zone.name;
      var fullname = zone.fullname;
      var uuid = UUIDGen.generate(id + name + fullname);
      //this.log.debug("found zone %s, %s, %s, %s, %s", id, type, name, fullname, uuid);

      // if the accessory was loaded from the cache, then skip
      var accessory = this.accessories.find(function(x) { return x.context.id === id; });
      if (accessory) {
         this.log("Zone %s already exists", id);
         return;
      }

      // create new accessory
      accessory = new Accessory(name, uuid);
      accessory.updateReachability(true);
      accessory.on('identify', function(paired, callback) {
         this.log("Identify %s", accessory.displayName);
         callback();
      }.bind(this));

      // set context so that we can find it in the array later
      accessory.context = {"id": id, "type": type, "name": fullname};

      // replace Service.AccessoryInformation information (homebridge.platformAccessory constructor adds this but doesn't set all fields)
      accessory.getService(Service.AccessoryInformation)
         .setCharacteristic(Characteristic.Name, name)
         .setCharacteristic(Characteristic.Manufacturer, fullname)
         .setCharacteristic(Characteristic.Model, type)
         .setCharacteristic(Characteristic.SerialNumber, id);

      // contact sensor: add Service.ContactSensor and set default value
      if (accessory.context.type === "contact") {
         accessory.addService(Service.ContactSensor)
            .setCharacteristic(Characteristic.ContactSensorState, Characteristic.ContactSensorState.CONTACT_DETECTED);

      // motion sensor: add Service.MotionSensor and set default value
      } else if (accessory.context.type === "motion") {
         accessory.addService(Service.MotionSensor)
            .setCharacteristic(Characteristic.MotionDetected, false);

      // co sensor: add Service.CarbonMonoxideSensor and set default value
      } else if (accessory.context.type === "co") {
         accessory.addService(Service.CarbonMonoxideSensor)
            .setCharacteristic(Characteristic.CarbonMonoxideDetected, Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL);

      // smoke sensor: add Service.SmokeSensor and set default value
      } else if (accessory.context.type === "smoke") {
         accessory.addService(Service.SmokeSensor)
            .setCharacteristic(Characteristic.SmokeDetected, Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);

      // unknown
      } else {
         this.log.warn("Zone %s has an unknown type %s", accessory.context.id, accessory.context.ype);
         return;
      }

      // push instance into the array
      this.accessories.push(accessory);

      // register it with homebridge
      this.api.registerPlatformAccessories("homebridge-alarmdecoderplatform", "AlarmDecoderPlatform", [accessory]);
      this.log("new zone accessory = %s, %s, %s, %s", id, type, name, fullname);
   }.bind(this));
}


/**
 * HTTP request handler for AlarmDecoder notifications.
 * AlarmDecoder custom notification: homebridge.local:51827, /, [x] POST, [x] urlencoded, Custom Key = “message”, Custom Value = “{{message}}"   (assumes default message strings)
 * @param {object} request - The HTTP request.
 * @param {object} response - The HTTP response.
 */
AlarmDecoderPlatform.prototype.requestHandler = function(request, response) {
   //this.log("RequestHandler");

   var data = '';
   if (request.method == "POST") {
      request.on('data', function(chunk) {
        data += chunk;
      });
      request.on('end', function() {
         this.log("Notification: %s", data.toString());
         var payload = JSON.parse(data.toString());

         //The alarm system has been triggered on zone {zone_name} ({zone})!                 .ALARM_TRIGGERED
         //The alarm system has stopped signaling the alarm for zone {zone_name} ({zone}).   .DISARM
         //The alarm system has been armed.                                                  .AWAY_ARM or .STAY_ARM
         //The alarm system has been disarmed.                                               .DISARM
         if (payload.message.indexOf("The alarm system has") === 0) {
            // Don't parse the strings, just get the current alarmdecoder panel state and use it to set the panel accessory state
            this.syncPanelState(function(error){}.bind(this));

            // SPECIAL: turn off smoke sensors
            var smokesensors = this.accessories.find(function(x) { return x.context.type === "smoke"; });
            if (smokesensors != null) {
               smokesensors.forEach(function(smokesensor) {
                  this.setHKZoneState(smokesensor.id, false, function(error){}.bind(this));
               }.bind(this));
            }

         //There is a fire!
         } else if (payload.message.indexOf("There is a fire!") === 0) {
            // SPECIAL: turn on all smoke sensors
            var smokesensors = this.accessories.find(function(x) { return x.context.type === "smoke"; });
            if (smokesensors != null) {
               smokesensors.forEach(function(smokesensor) {
                  this.setHKZoneState(smokesensor.id, true, function(error){}.bind(this));
               }.bind(this));
            }

         //Zone {zone_name} ({zone}) has been faulted.
         //Zone {zone_name} ({zone}) has been restored.
         } else if (payload.message.indexOf("Zone ") === 0) {
            // Parse the strings because there is no way to get individual alarmdecoder zone state (unless you check panel_zones_faulted array which seems costly to make another rest call and could become inconsist due to race/time conditions)
            var found = payload.message.match(/^Zone (.+) \((\d+)\) has been (\w*)/);
            if (found != null) {
               var fullname = found[1];
               var id = found[2];
               var state = (found[3] === "faulted") ? true : false;
               this.setHKZoneState(id, state, function(error){}.bind(this));
            } else {
               this.log.warn("Unable to parse zone notification message");
            }

         // other messages
         } else {
            ;
         }
      }.bind(this));
   }

   response.writeHead(200, {'Content-Type': 'text/plain'});
   response.end();
}


/**
 * Homekit request to get current alarmdecoder panel state in order for it to set panel accessory state.
 * @param {object} callback - The Homebridge callback function (error, state). For the second parameter use Characteristic.SecuritySystemTargetState.STAY_ARM = 0, AWAY_ARM = 1, NIGHT_ARM = 2, DISARM = 3, ALARM_TRIGGERED = 4.
 */
AlarmDecoderPlatform.prototype.getPanelCurrentState = function(callback) {
   this.log("GetPanelCurrentState");

   this.getADPanelState(callback);
}


/**
 * User/Homekit request to change alarmdecoder panel state and panel accessory state.
 * @param {integer} state - The requested security system target state, Characteristic.SecuritySystemTargetState.STAY_ARM = 0, AWAY_ARM = 1, NIGHT_ARM = 2, DISARM = 3.
 * @param {object} callback - The Homebridge callback function (error).
 */
AlarmDecoderPlatform.prototype.setPanelTargetState = function(state, callback) {
   this.log("SetPanelTargetState: %s", state);

   this.setADPanelState(state, function(error) {
      if (error != null) {
         callback(error);
         return;
      }
      this.setHKPanelState(state, callback);
   }.bind(this));
}


/**
 * Helper function to sync panel accessory state with alarmdecoder panel state
 */
AlarmDecoderPlatform.prototype.syncPanelState = function(callback) {
   //this.log("SyncPanelState");

   this.getADPanelState(function(error, state) {
      if (error != null) {
         callback(error);
         return;
      }
      this.setHKPanelState(state, callback);
   }.bind(this));

   // SPECIAL: need to pause on stay to see if night/immediate mode active
   //this.getADPanelState(function(error, state) {
   //   if (error != null) {
   //      callback(error);
   //      return;
   //   }
   //   if (state === 0) {
   //      waitUntil().interval(3000).times(1).condition(function() { return true; }).done(function(result) {
   //         this.getADPanelState(function(nestedError, nestedState) {
   //            if (nestedError != null) {
   //               callback(error);
   //               return;
   //            }
   //            this.setHKPanelState(nestedState, callback);
   //         }.bind(this));
   //      }.bind(this));
   //   } else {
   //      this.setHKPanelState(state, callback);
   //   }
   //}.bind(this));
}


/**
 * Helper function to get the alarmdecoder panel state.
 * @param {object} callback - The callback function (error, state).
 */
AlarmDecoderPlatform.prototype.getADPanelState = function(callback) {
   //this.log("GetADPanelState");

   var endpoint = this.config.endpoints.get;
   var method = endpoint.method;
   var url = endpoint.url;
   var body = "";
   if (url == null || body == null || method == null) {
      this.log.error("Failed: unable to get endpoint information");
      callback(new Error("Failed: unable to get endpoint information"));
      return;
   }

   //this.log.debug("%s %s %s", method, url, body);
   request( { method: method, url: url, headers: {'Authorization': this.config.key, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: body }, function(error, response, body) {
      if (error != null || response.statusCode < 200 || response.statusCode > 299) {
         var statuscode = response ? response.statusCode : 0;
         this.log.error("Failed: %s %s [%s] %s", method, url, statuscode, error);
         callback(new Error("Failed: unable to make api call"));
         return;
      }

      // {"last_message_received": "[10000001100000003A--],008,[f722000f1008001c28020000000000],\" DISARMED CHIME   Ready to Arm  \"", "panel_alarming": false, "panel_armed": false, "panel_armed_stay": false, "panel_bypassed": {}, "panel_fire_detected": false, "panel_on_battery": false, "panel_panicked": false, "panel_powered": true, "panel_relay_status": [], "panel_type": "ADEMCO", "panel_zones_faulted": [] }
      var stateObj = JSON.parse(body);
      var isAlarming = stateObj.panel_alarming;
      var isArmedAway = stateObj.panel_armed;
      var isArmedStay = stateObj.panel_armed_stay;
      var isArmedNight = false;
      var lastmessage = stateObj.last_message_received;
      if (lastmessage && (lastmessage.includes("NIGHT") || lastmessage.includes("INSTANT")))
         isArmedNight = true;
      /* Characteristic.SecuritySystemCurrentState.STAY_ARM = 0, .AWAY_ARM = 1, .NIGHT_ARM = 2, .DISARMED = 3, .ALARM_TRIGGERED = 4 */
      var state = Characteristic.SecuritySystemCurrentState.DISARMED; // 3
      if (isAlarming)
         state = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED; // 4
      else if (isArmedAway && !isArmedNight && !isArmedStay)
         state = Characteristic.SecuritySystemCurrentState.AWAY_ARM;  // 1
      else if (isArmedNight)
         state = Characteristic.SecuritySystemCurrentState.NIGHT_ARM; // 2
      else if (isArmedStay)
         state = Characteristic.SecuritySystemCurrentState.STAY_ARM;  // 0
      else
         state = Characteristic.SecuritySystemCurrentState.DISARMED;  // 3

      this.log("current alarmdecoder panel state = %s", state);
      callback(null, state);
   }.bind(this));
}


/**
 * Helper function to set the alarmdecoder panel state.
 * @param {integer} state - The requested security system target state, Characteristic.SecuritySystemTargetState.STAY_ARM = 0, .AWAY_ARM = 1, .NIGHT_ARM = 2, .DISARM = 3
 * @param {object} callback - The callback function (error).
 */
AlarmDecoderPlatform.prototype.setADPanelState = function(state, callback) {
   //this.log("SetADPanelState: %s", state);

   var endpoint = null;
   switch (state) {
      case Characteristic.SecuritySystemTargetState.DISARM:    // 3
         endpoint = this.config.endpoints.disarm;
         break;
      case Characteristic.SecuritySystemTargetState.AWAY_ARM:  // 1
         endpoint = this.config.endpoints.away;
         break;
      case Characteristic.SecuritySystemTargetState.STAY_ARM:  // 0
         endpoint = this.config.endpoints.stay;
         break;
      case Characteristic.SecuritySystemTargetState.NIGHT_ARM: // 2
         endpoint = this.config.endpoints.night;
         break;
   }
   var method = endpoint.method;
   var url = endpoint.url;
   var body = JSON.stringify({"keys": endpoint.body});
   if (method == null || url == null || body == null) {
      this.log.error("Failed: unable to get endpoint information");
      callback(new Error("Failed: unable to get endpoint information"));
      return;
   }

   //this.log.debug("%s %s %s", method, url, body);
   request( { method: method, url: url, headers: {'Authorization': this.config.key, 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: body }, function(error, response, body) {
      if (error != null || response.statusCode < 200 || response.statusCode > 299) {
         var statuscode = response ? response.statusCode : 0;
         this.log.error("Failed: %s %s [%s] %s", method, url, statuscode, error);
         callback(new Error("Failed: unable to make api call"));
         return;
      }

      this.log("new alarmdecoder panel state = %s", state);
      callback(null);
   }.bind(this));
}


/**
 * Helper function to set the panel accessory state.
 * @param {integer} state - The requested security system target state, Characteristic.SecuritySystemTargetState.STAY_ARM = 0, AWAY_ARM = 1, NIGHT_ARM = 2, DISARM = 3.
 * @param {object} callback - The callback function (error).
 */
AlarmDecoderPlatform.prototype.setHKPanelState = function(state, callback) {
   //this.log("SetHKPanelState: %s", state);

   var accessory = this.accessories.find(function(x) { return x.context.type === "panel"; });
   if (accessory == null) {
      this.log.error("Failed: unable to find panel accessory");
      callback(new Error("Failed: unable to find panel accessory"));
      return;
   }

   //accessory.getService(Service.SecuritySystem).getCharacteristic(Characteristic.SecuritySystemCurrentState).setValue(state);
   accessory.getService(Service.SecuritySystem).getCharacteristic(Characteristic.SecuritySystemCurrentState).updateValue(state);
   this.log("new panel accessory state = %s", state);
   callback(null);
}


/**
 * Helper function to set the zone accessory state.
 * @param {string} id - The zone id, defined in config.json.
 * @param {bool} state - The requested security system target state, FAULTED = true, NORMAL/RESTORED = false.
 * @param {object} callback - The callback function (error).
 */
AlarmDecoderPlatform.prototype.setHKZoneState = function(id, state, callback) {
   //this.log("SetHKZoneState: %s, %s", id, state);

   var accessory = this.accessories.find(function(x) { return x.context.id === id; });
   if (accessory == null) {
      this.log.error("Failed: unable to find zone accessory");
      callback(new Error("Failed: unable to find zone accessory"));
      return;
   }

   // contact sensor:
   if (accessory.context.type === "contact") {
      var cstate = state ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED;
      //accessory.getService(Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState).setValue(cstate);
      accessory.getService(Service.ContactSensor).getCharacteristic(Characteristic.ContactSensorState).updateValue(cstate);
      this.log("new zone %s accessory state = %s", id, cstate);
      callback(null);

   // motion sensor:
   } else if (accessory.context.type === "motion") {
      var mstate = state;
      //accessory.getService(Service.MotionSensor).getCharacteristic(Characteristic.MotionDetected).setValue(mstate);
      accessory.getService(Service.MotionSensor).getCharacteristic(Characteristic.MotionDetected).updateValue(mstate);
      this.log("new zone %s accessory state = %s", id, mstate);
      callback(null);

   // co sensor:
   } else if (accessory.context.type === "co") {
      var costate = state ? Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL : Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
      //accessory.getService(Service.CarbonMonoxideSensor).getCharacteristic(Characteristic.CarbonMonoxideDetected).setValue(costate);
      accessory.getService(Service.CarbonMonoxideSensor).getCharacteristic(Characteristic.CarbonMonoxideDetected).updateValue(costate);
      this.log("new zone %s accessory state = %s", id, costate);
      callback(null);

   // smoke sensor:
   } else if (accessory.context.type === "smoke") {
      var sstate = state ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
      //accessory.getService(Service.SmokeSensor).getCharacteristic(Characteristic.SmokeDetected).setValue(sstate);
      accessory.getService(Service.SmokeSensor).getCharacteristic(Characteristic.SmokeDetected).updateValue(sstate);
      this.log("new zone %s accessory state = %s", id, sstate);
      callback(null);

   // unknown
   } else {
      this.log.warn("Zone %s has an unknown type %s", accessory.context.id, accessory.context.type);
      callback(new Error("Unknown zone type"));
   }
}
