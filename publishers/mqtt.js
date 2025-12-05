// Publisher which publishes on mqtt

const mqtt = require('mqtt')

const REPLACE_STRING = "deveui";

const printErrorAndExit = (info) => {
    console.log(info);
    process.exit(1);
}

let client;

module.exports.api = {
    checkArgumentsOrExit: (args) => {
        if (!args.S)
            printErrorAndExit("MQTT Publisher: -S <mqtt server> is required");
        if (!args.T)
            printErrorAndExit("MQTT Publisher: -T <topic format> is required");
        if (!args.T.includes(REPLACE_STRING))
            printErrorAndExit("MQTT Publisher: -T <topic format> must contain the substutution string " + REPLACE_STRING)
    },
    initialize: (args) => {
            const options = {
                // Clean session
                // clean: true,
                // connectTimeout: 4000,
                // Authentication
                // clientId: args.u,
                username: args.u,
                password: args.p,
            }

            client = mqtt.connect(args.S , options);

            client.on('connect', () => {
                args.v && console.log("MQTT Publisher: Connected to mqtt broker");
            });
    },
    publish: (args, deviceid, obj) => {
        console.log("MQTT Publishing", deviceid, obj);
        const topic = args.T.replace(REPLACE_STRING, deviceid);
        try {
            client.publish(topic,  JSON.stringify(obj));
        } catch (e) {
            console.log("MQTT Publisher: Failed to publish: ", e.message);
        }
    },
    getVersionString: () => {
        return "MQTT Publisher";
    }
}
