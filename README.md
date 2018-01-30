# homebridge-alarmdecoderplatform

Homebridge platform plugin for the AlarmDecoder (alarmdecoder.com) interface to Honeywell/DSC Systems.

This plugin creates a HomeKit security system accessory for the "panel" and HomeKit contact/motion accessories for the defined "zones".

## Requirements

- Security system user code
- IP address and port of the running and up-to-date AlarmDecoder web app
- AlarmDecoder web app user configured with an API key

## Installation

1. Install Homebridge using: `npm install -g homebridge`
2. Install this plugin using: `npm install -g git+https://github.com/michaelpmaley/homebridge-alarmdecoderplatform.git#master`
3. Update Homebridge configuration file (see below)
4. Create AlarmDecoder custom notification (see below)

## Configuration - Homebridge

Add the following entry into the Homebridge config.json file platforms array:

```
   "platforms": [
      {
         "platform" : "AlarmDecoderPlatform",
         "port": PLUGINPORT,
         "key": "AD API KEY",
         "endpoints": {
               "disarm": { "method": "POST", "url": "http://ADIP:ADPORT/api/v1/alarmdecoder/send", "body": "99991" },
               "away":   { "method": "POST", "url": "http://ADIP:ADPORT/api/v1/alarmdecoder/send", "body": "99992" },
               "stay":   { "method": "POST", "url": "http://ADIP:ADPORT/api/v1/alarmdecoder/send", "body": "99993" },
               "night":  { "method": "POST", "url": "http://ADIP:ADPORT/api/v1/alarmdecoder/send", "body": "99993" },
               "get":    { "method": "GET",  "url": "http://ADIP:ADPORT/api/v1/alarmdecoder",      "body": "" }
         },
         "panel": {
            "name": "Alarm System",
            "manufacturer": "Ademco",
            "model": "Vista 20p",
            "serialnumber": "111111",
            "firmware": "1.0.0"
         },
         "zones": [
            { "id": "9",  "type": "contact", "name": "Door", "fullname": "Front Door" },
            { "id": "10", "type": "contact", "name": "Door", "fullname": "Living Room Door" },
            { "id": "11", "type": "motion",  "name": "Motion", "fullname": "Upstairs Hall Motion" },
            { "id": "12", "type": "motion",  "name": "Glass Break", "fullname": "Living Room Glass" },
            { "id": "13", "type": "contact", "name": "Door", "fullname": "Master Bedroom Door" },
            { "id": "14", "type": "motion",  "name": "Glass Break", "fullname": "Master Bedroom Glass" },
            { "id": "15", "type": "motion",  "name": "Motion", "fullname": "Downstairs Hall Motion" },
            { "id": "16", "type": "motion",  "name": "Glass Break", "fullname": "Office Glass" },
            { "id": "17", "type": "motion",  "name": "Glass Break", "fullname": "Family Room Glass" },
            { "id": "18", "type": "contact", "name": "Door", "fullname": "Family Room Door" }
         ]
      }
   ]
```

- **port** = set the port the plugin will listen for AlarmDecoder web app notifications on
- **key** = set the AlarmDecoder user API key
- **endpoints** section
  - In each **url**, replace ADIP and ADPORT with the correct AlarmDecoder web app IP and port values
  - In each **body**, replace 9999 with the correct user code (the last digit is for arm stay, arm away, disarm)
- **panel** section
  - **name** = set the name that will be displayed in HomeKit
  - Change the other values as desired, they are informational only
- **zones** section = create an entry for each zone in your system using:
  - **id** - the AlarmDecoder zone id; also displayed in the serial number field
  - **type** - must be either "contact" or "motion" or "co" or "smoke"
  - **name** - the name that will be displayed in HomeKit (the room name is prefixed)
  - **fullname** - displayed in the manufacturer field to help differentiate zones because the name is basically generic

**IMPORTANT:** CO and Smoke sensor support has not been tested. Upon receiving a "There is a fire!" message, the code will fault all smoke sensors and when the system is subsequently disarmed, the code will restore all smoke sensors.

## Configuration - AlarmDecoder

Create an AlarmDecoder notification with the following values:
- **Nofication Type** = Custom
- **Description** = whatever you want
- **Notification Events** = check/tick the first 8 items
- **Custom Settings**
  - **URL** = IP address of the Homebridge server and the plugin listening port, e.g. 10.0.1.67:51827
  - **Path** = /
  - **Method** = POST
  - **Type** = JSON
  - Click **Add Field**
    - **Custom Key** = "message"   (do not include the quotes)
    - **Custom Value** = "{{message}}"   (do not include the quotes)

Notification events, for reference:
- Alarm system is triggered
- Alarm system stops signaling
- A panic has been detected
- A fire is detected
- Alarm system is armed
- Alarm system is disarmed
- A zone is faulted
- A zone has been restored
- A zone has been bypassed
- Power status has changed
- A low battery has been detected
- The AlarmDecoder has rebooted
- A relay has changed

**IMPORTANT:** Assumes the default message strings, so don't customize them. Default message strings, for reference:
- The alarm system has been triggered on zone {zone_name} ({zone})!
- The alarm system has stopped signaling the alarm for zone {zone_name} ({zone}).
- The alarm system has been armed.
- The AlarmDecoder has finished booting.
- A zone has been bypassed.
- The alarm system has been disarmed.
- There is a fire!
- Low battery detected.
- Panic!
- Power status has changed to {status}.
- A relay has changed.
- Zone {zone_name} ({zone}) has been faulted.
- Zone {zone_name} ({zone}) has been restored.

## Source Material

- https://github.com/nfarina/homebridge#writing-plugins
- https://github.com/aficustree/homebridge-alarmdecoder   (this was my main starting point)
- http://blog.theodo.fr/2017/08/make-siri-perfect-home-companion-devices-not-supported-apple-homekit/
- https://github.com/nfarina/homebridge/blob/master/example-plugins/homebridge-samplePlatform/index.js
- https://github.com/KhaosT/HAP-NodeJS/blob/master/lib/gen/HomeKitTypes.js
- and other various Homebridge plugins on GitHub

## Files

- `index.js` is the base implementation. Zones start as "normal" and only change state based upon Alarmdecoder notifications. This means there are cases where the zone states are incorrect, e.g. starting the homebridge service with a faulted zone.
- `index_getzonestate.js` is an alternative to `index.js`. In this implementation, zone state is determined dynamically. In my opinion, the implementation is a bit fragile (since there is no specific Alarmdecode api for it) and costly (a lot of Alarmdecoder get calls), but if you have automation depedendent on zones, then it might be worth it.

## Issues

- Very infrequently AlarmDecoder missed an event. Added and modified logging in /opt/alarmdecoder-webapp/ad2web/notifications/types.py to watch what was going on.
- iOS notifications are inconsistent. Could be local networking, Homekit, Homebridge to Homekit/Home app communication (.updateValue changes).
