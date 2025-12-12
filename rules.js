/*
The MIT License (MIT)

Copyright Sensative AB 2023. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/

const LOG = require('./utils/log');
const { mergeDeep, delay } = require('./util');
let translatorVersion = "";
try {
  // Running at top level
  translatorVersion = require('./node_modules/vsm-translator-open-source/package.json').version;
} catch (e) {
  // Running as npm package
  translatorVersion = require('../vsm-translator-open-source/package.json').version;
}
LOG.info("Translator Version: " + translatorVersion);

const ASSISTANCE_INTERVAL_S =  60*30; // max 300km/h
const MAX_ALMANAC_AGE_S =   60*60*24*30; // This is a monthly process
const ALMANAC_DOWNLOAD_INTERVAL_S = 60*60*12; // No more frequent tries than this

const byteToHex2 = (b) => {
  const table = "0123456789abcdef";
  return "" + table[(b>>4)&0xf] + table[b&0xf];
}

const int32ToHex8 = (n) => {
  return "" + byteToHex2(n>>24) + byteToHex2(n>>16) + byteToHex2(n>>8) + byteToHex2(n);
}


const downlinkAssistancePositionIfMissing = async (args, integration, client, solver, deviceid, next, lat, lng) => {
  if (lat && lng && next && next.gnss) {
    let updateRequired = false;
    if (next.gnss.lastAssistanceUpdateAttempt) {
      lastTime = new Date(next.gnss.lastAssistanceUpdateAttempt);
      now = new Date();
      if (now.getTime() - lastTime.getTime() < ASSISTANCE_INTERVAL_S*1000) {
        return next; // Do nothing
      }
    }

    if (!next.gnss.assistanceLatitude || Math.abs(lat - next.gnss.assistanceLatitude) > 0.1)
      updateRequired = true;
    if (!next.gnss.assistanceLongitude || Math.abs(lng - next.gnss.assistanceLongitude) > 0.1)
      updateRequired = true;
    if (updateRequired) {
      next.gnss.lastAssistanceUpdateAttempt = new Date();

      const lat16 = Math.round(2048*lat / 90) & 0xffff;
      const lon16 = Math.round(2048*lng / 180) & 0xffff;
      let downlink = "01"; // Begin with 01 which indicates that this is a assisted position
      let str = lat16.toString(16);
      while (str.length < 4)
        str = "0"+str;
      downlink += str;
      str = lon16.toString(16);
      while (str.length < 4)
        str = "0"+str;
      downlink += str;

      integration.api.sendDownlink(client, args, deviceid, 21, Buffer.from(downlink, "hex"), false /* confirmed */ );
    }
  }
  return next;
}

const downlinkCrcRequest = (args, integration, client, deviceid) => {
  integration.api.sendDownlink(client, args, deviceid, 15, Buffer.from("00", "hex"), false /* confirmed */ );
}

const downlinkDeviceTimeDelta = (args, integration, client, deviceid, deltaS) => {
  let buffer = "08" + int32ToHex8(deltaS);
  integration.api.sendDownlink(client, args, deviceid, 21, Buffer.from(buffer, "hex"), false /* confirmed */ );
}

const downlinkAlmanac = async (args, integration, client, solver, deviceid, maxSize) => {
    const f = async () => {
        const almanac = await solver.api.loadAlmanac(args);
        if (!(almanac && almanac.result && almanac.result.almanac_image)) {
            console.log("Bad alamanac data");
            return;
        }

        const compressedAlmanac = almanac.result.almanac_compressed;
        const image = compressedAlmanac ? compressedAlmanac : almanac.result.almanac_image;

        let maxDownlinkSize = maxSize - 6; // Give space for some mac commands
        if (maxDownlinkSize < 30) {
          // Does not make sense with this small downlink size for almanac download
          console.log("Too many almanac downlinks, cancelling until better connection acheived");
          return;
        }
        const almanacTypeStr = (compressedAlmanac ? "Compressed" : "Full");
        console.log("Almanac image type: " + almanacTypeStr);
        console.log("Selected payload size: " + maxDownlinkSize);
        console.log("Almanac image size: " + image.length / 2 );
        console.log("Downlink count: " + image.length / 2 / maxDownlinkSize);

        let chunks = image.match(new RegExp('.{1,' + (maxDownlinkSize*2 /* 40 is randomly selected */ ) + '}', 'g'));
        console.log("Chunks: " + chunks.length);

        for (let i = 0; i < chunks.length; ++i) {
            var data;
            if (i === 0) // Begin new almanac
                data = "02";
            else if (i === chunks.length-1) {
                if (compressedAlmanac)
                    data = "05"; // End compressed almanac
                else
                    data = "04"; // End uncompressed almanac
            }
            else
                data = "03"; // Plain almanac segment
            data += chunks[i];

            try {
                await integration.api.sendDownlink(client, args, deviceid, 21, Buffer.from(data, "hex"), true);
                console.log(deviceid, almanacTypeStr + " Almanac downlink " + (i+1) + " of " + chunks.length + " - enqueueing");
                await delay(1000); // Increase chance of correct order in chirpstack
            } catch (e) { return; }
        }
    }
    // Do not await the results here
    f();
}


const rules = [
  // Detect if we do not know which application the device is running (meaning it cannot be translated fully)
  async (args, integration, client, solver, deviceid, next, updates, date, lat, lng) => {
    // Check if the rules CRC is registerred
    if (next.vsm && next.vsm.rulesCrc32)
      return next;
    // This needs to be resolved ASAP
    downlinkCrcRequest(args, integration, client, deviceid);
    return next;
  },

  // Detect if device time is off, and if so downlink a time correction
  async (args, integration, client, solver, deviceid, next, updates, date, lat, lng) => {
    // Check if this update was a gnss message containing deviceTime
    if (!updates.gnss)
      return next;
    if (!(updates.gnss.deviceTime && updates.gnss.deviceTimeTimestamp))
      return next;
    let deviceDateS = new Date(updates.gnss.deviceTime).getTime()/1000;
    let receivedDateS = new Date(updates.gnss.deviceTimeTimestamp).getTime()/1000;
    let deltaS = receivedDateS - deviceDateS;
    args.v && console.log("Device time offset: " + deltaS);
    if (deltaS >= 5 || deltaS <= 5) {
        // Send downlink
        console.log("Updating device time for " + deviceid + " by " + deltaS + "s");
        downlinkDeviceTimeDelta(args, integration, client, deviceid, Math.round(deltaS));
    }
    return next;
  },

  // Solve positions and add the solution to the data
  async (args, integration, client, solver, deviceid, next, updates, date, lat, lng) => {
    const hasWifi = updates.semtechEncoded && updates.semtechEncoded.msgtype === "wifi";
    const hasGnss = updates.gnss && updates.gnss.completeHex;

    if ((hasWifi || hasGnss) && !args.hasOwnProperty("N")) {
      // Call semtech to resolve the location
      LOG.info("New positioning data");
      let solved = await solver.api.solvePosition(args, updates);
      if (solved && solved.result) {
        const synthesized = {
          // place all position fields directly on the object we merge into `next`
          ...solved.result
        };
        if (Array.isArray(solved.warnings)) {
          synthesized.warnings = solved.warnings;
        }
        if (Array.isArray(solved.errors)) {
          synthesized.errors = solved.errors;
        }
        // Extra check: If we have a result here but no assistance data in the device, use this to generate an assistance position
        // and downlink it to the device
        downlinkAssistancePositionIfMissing(args, integration, client, solver, deviceid, next, lat, lng);
        return synthesized;
      } else {
        return null;
      }
    }
  },

  // Detect absense of device assistance position OR the too large difference of lat & long vs assistance position,
  // try to solve that by downloading new assistance position
  async (args, integration, client, solver, deviceid, next, updates, date, lat, lng) => {
    // try download from gateway position only if there is no assistance position, else use solutions
    if (next.gnss && !next.gnss.assistanceLatitude)
      downlinkAssistancePositionIfMissing(args, integration, client, solver, deviceid, next, lat, lng);
  },

  // Detect if almanac download is called for
  async (args, integration, client, solver, deviceid, next, updates, date, lat, lng) => {
    // Do we know if there is an almanac timestamp?
    if (!(next.gnss && next.gnss.almanacTimestamp))
        return next;

    const almanacDate = new Date(next.gnss.almanacTimestamp);
    if (date.getTime() - almanacDate.getTime() < MAX_ALMANAC_AGE_S*1000)
        return next; // Unmodified

    const lastAttemptMs = next.gnss.lastAlmanacDownloadAttempt ? new Date(next.gnss.lastAlmanacDownloadAttempt).getTime() : 0;
    const lastAttemptPeriodS = (date.getTime() - lastAttemptMs)/1000;
    if (lastAttemptPeriodS < ALMANAC_DOWNLOAD_INTERVAL_S)
        return next; // Do not attempt a download now
    next.gnss.lastAlmanacDownloadAttempt = date;

    // Run this asynchronously rather than wait
    if (!solver.api.downlinkAlmanac) {
      return next;
    }
    downlinkAlmanac(args, integration, client, solver, deviceid, next.encodedData.maxSize);

    return next;
  },

  // Update translator version
  async (args, integration, client, solver, deviceid, next, updates, date, lat, lng) => {
    if (next.vsm) {
      next.vsm.translatorVersion = translatorVersion;
    } else
      next.vsm = { translatorVersion };
    return next;
  },
];

module.exports.processRules = async (args, integration, client, solver, deviceid, next, updates, date, lat, lng) => {
  // console.log("processRules - updates:", deviceid, updates);
  for (let i = 0; i < rules.length; ++i) {
    synthesized = await rules[i](args, integration, client, solver, deviceid, next, updates, date, lat, lng);
    if (synthesized) {
      next = mergeDeep(next, synthesized);
    }
  }
  return next;
}
