const LOG = require('../utils/log');
const combainLoraCloud= "https://lw.traxmate.io";
const endpointWifi = combainLoraCloud +"/api/v1/solve/loraWifi";
const endpointGnss = combainLoraCloud +"/api/v1/solve/gnss_lora_edge_singleframe";
const endpointAlmanac = combainLoraCloud + "/api/v1/almanac/full";

// import fetch from 'node-fetch'
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

const solvePosition = async (args, data) => {
    if (!args.k)
        return;

    const isWifi = data.semtechEncoded && (data.semtechEncoded.msgtype === "wifi");
    const endpoint = isWifi ? endpointWifi : endpointGnss;
    let body = isWifi ? data.wifi : (data.semtechEncoded ? data.semtechEncoded : data.semtechGpsEncoded);
    body = JSON.parse(JSON.stringify(body)); // Make a copy of this object since it is manipulated below
    if (isWifi) {
        delete body.timestamp;
        if ((!body.wifiAccessPoints) || body.wifiAccessPoints.length < 2) {
            LOG.error(data);
            return {errors:["Too few access points to solve position ("+ (body.wifiAccessPoints ? body.wifiAccessPoints.length:"none" )+")"]};
        }

        // The below is a workaround since this data is likely not available in good enough precision, in particular with mobile gateways
        body.lorawan = [
            {
                "gatewayId": "00-00-E4-77-6B-00-1A-5D",
                "antennaId": 0,
                "rssi": -86.0,
                "snr": 15.0,
                "toa": 10000,
                "antennaLocation": {
                    "latitude":46.98886,
                    "longitude":6.91287,
                    "altitude":513
                }
            },
            {
                "gatewayId": "00-00-E4-77-6B-00-1A-5D",
                "antennaId": 1,
                "rssi": -87.0,
                "snr": 15.0,
                "toa": 5000,
                "antennaLocation": {
                    "latitude":46.98886,
                    "longitude":6.91287,
                    "altitude":513
                }
            },
            {
                "gatewayId": "00-00-E4-77-6B-00-1A-97",
                "antennaId": 0,
                "rssi": -89.0,
                "snr": 15.0,
                "toa": 8000,
                "antennaLocation": {
                    "latitude":46.983753,
                    "longitude":6.906008,
                    "altitude":479
                }
            },
            {
                "gatewayId": "00-00-E4-77-6B-00-1A-97",
                "antennaId": 1,
                "rssi": -89.0,
                "snr": 10.0,
                "toa": 20000,
                "antennaLocation": {
                    "latitude":46.983753,
                    "longitude":6.906008,
                    "altitude":479
                }
            }];
        }
    // console.log(endpoint);
    delete body.msgtype;
    delete body.timestamp;
    // console.log(body);
    LOG.post(endpoint);
    const response = await fetch(endpoint,
        {
          method:"POST",
          headers: {
            "Authorization": args.k,
            "Content-type" : "application/json",
          },
          body:JSON.stringify(body),
        })
        .then(response => {
            if(!response.ok) {
                LOG.error(response.statusText);
                throw new Error('Could not fetch ' + (isWifi ? "wifi":"gnss")+ ' api, response: ' + response.status);
            }
            return response.json();
        })
        .then(data => data)
        .catch(err => {
          LOG.error("API failed: " + endpoint + " " + err.message);
          return null;
        });

    args.v && LOG.info("Combain loraCloud solver response:", response);
    if (isWifi) {
        if (response && response.result && response.result.algorithmType !== "Wifi")
            return {errors:["Got wrong type of response: " + response.result.algorithmType]};
    }

    // A small cludge or two - but positions are not particularily interresting unless they
    // are timestamped. The resolver can give timestamps, but this is added as an insurance
    if (response && response.result && response.result.latitude)
        response.result.positionTimestamp = new Date();
    return response;
}

// Reverse run-length encode, encodes into a buffer which ends with a byte
// of format either of
// (0xxx xxxx) is replaced with x bytes of zeros (x>=1)
// (1xxx xxxx) meaning it should copy xx bytes. (x>=1)
// Next previous byte is of same format.
// Use this function with a following RRLEDecode for checking that there is no buffer underrun
// before sending the data.
// TODO: Optimize to avoid excessive copying of data.
const RRLEEncode = (buf) => {
    let output = Buffer.from('', 'hex');
    let pos = 0;
    let len = buf.length;
    let nonzeros = 0;
    while (pos < len) {
        // Count how many zeros are at the current position
        let zeros;
        for (zeros = 0; zeros < len-pos && zeros < 128; ++zeros) {
            if (buf[pos+zeros] !== 0)
                break;
        }
        if (zeros >= 2) {
            // Output how many non-zeros we just cooked
            if (nonzeros > 0) {
                // add an overhead byte
                let buffer2 = Buffer.from([0x80 + nonzeros]);
                output = Buffer.concat([output, buffer2]);
            }
            // output code 0xxx xxxx
            let buffer2 = Buffer.from([zeros]);
            output = Buffer.concat([output, buffer2]);
            pos += (zeros-1);
            nonzeros = 0;
        }
        else { // Less than two zeroes here
            // Copy this positions value to output
            nonzeros++;
            let buffer2 = Buffer.from([buf[pos]]);
            output = Buffer.concat([output, buffer2]);
        }

        if (nonzeros == 127 || pos === len-1) {
            if (nonzeros > 0) {
                // Need to dump one extra byte stating how many non-zeros
                let buffer2 = Buffer.from([0x80 + nonzeros]);
                output = Buffer.concat([output, buffer2]);
                nonzeros = 0;
            }
        }

        pos++;
    }

    LOG.info("RRLE Result: " + output.length + " bytes, original: " + buf.length + " bytes");
    return output;
}

const RRLEDecode = (buf, expectedSize) => {
    let inpos = buf.length;
    let result = Buffer.alloc(expectedSize, 0);
    let outpos = expectedSize;
    while (inpos > 0) {
        if (outpos <= 0)
            throw new Error(`Negative output position`);
        inpos--;
        if (outpos < inpos)
            throw new Error(`Output position before input position: outpos: ${outpos} inpos: ${inpos}`);
        let len = buf[inpos] & 0x7f;
        let zero = (buf[inpos] & 0x80) === 0;

        if (len > outpos)
            throw new Error(`Invalid length found at inpos ${inpos}, would cause output underrun`);

        if (!zero) {
            while (len--)
                result[--outpos] = buf[--inpos];
        } else {
            // Skip zeros
            outpos-=len;
        }
    }
    if (outpos != 0 || inpos != 0)
        throw new Error("Output and input did not end at zero");
    return result;
}

let almanacCache;
let almanacTimestamp_ms;

const ALMANAC_CACHE_MAX_AGE_S = 60*60*24;

const loadAlmanac = async (args) => {
    const nowMs = new Date().getTime();
    if (almanacCache && almanacTimestamp_ms && nowMs-almanacTimestamp_ms < ALMANAC_CACHE_MAX_AGE_S*1000)
        return almanacCache;

    if (!args.k)
        return;
    LOG.get(endpointAlmanac);
    const response = await fetch(endpointAlmanac,
        {
          method:"GET",
          headers: {
         //   "Ocp-Apim-Subscription-Key": loraoldcloudapikey,
            "Authorization" : args.k,
            "Content-type" : "application/json"
          },
        })
        .then(response => { if(!response.ok) throw new Error('Login failed - check username and password'); return response.json()})
        .then(data => data)
        .catch(err => {
          LOG.error("Login failed - connection problem?");
          return null;
        });

    if (response && response.result && response.result.almanac_image) {
        const buf = Buffer.from(response.result.almanac_image, "base64");
        response.result.almanac_image = buf.toString("hex");

        // Optionally add a compressed and tested version of the same image to the result
        try {
            const compressed = RRLEEncode(buf);
            if (compressed.length >= buf.length)
                throw new Error("The compressed length exceeds the uncompressed length");
            const decompressed = RRLEDecode(compressed, buf.length);
            if (decompressed.length != buf.length)
                throw new Error("The uncompress yields wrong length");
            const compressed_hex = decompressed.toString('hex');
            if (compressed_hex !== response.result.almanac_image)
                throw new Error("Decompression generated wrong result");
            response.result.almanac_compressed = compressed.toString('hex');
        } catch (err) {
            LOG.error(err);
        }
    }

    if (response && response.result && response.result.almanac_image) {
        LOG.info("ALMANAC ADDED TO CACHE:", response);
        almanacTimestamp_ms = nowMs;
        almanacCache = response;
    }
    return response;
}

module.exports.api = {
    solvePosition,
    loadAlmanac,
    checkArgumentsOrExit: (args)=>{if (!args.k) throw new Error("-k <API key> is required for combainLoraCloud solver"); },
    getVersionString: ()=>"combainLoraCloud Solver",
    initialize: (args) => {}
};
