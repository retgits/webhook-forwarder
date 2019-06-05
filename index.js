/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2018-2019 retgits
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
**/

/**
 * Webhook Receiver for Solace PubSub+ Cloud
 * Receives messages from Solace PubSub+ Cloud and forwards it to an internal
 * endpoint.
**/

// Requires
var solace = require('solclientjs').debug;
var https = require("https");

// Variables needed to connect to Solace
// These variables can be found on the connect tab of your
// Solace PubSub+ Cloud instance
var vpn = process.env.SOLACE_VPN_NAME;
var hosturl = process.env.SOLACE_URL;
var username = process.env.SOLACE_USERNAME;
var pass = process.env.SOLACE_PASSWORD;
var topic = process.env.SOLACE_TOPIC;

// Variables to send the request to
// These are variables that determine where to forward the webhooks to
var targetHost = process.env.WEBHOOK_HOST;
var targetPath = process.env.WEBHOOK_PATH;
var targetPort = process.env.WEBHOOK_PORT;

// Other variables
var loglevel = process.env.LOGLEVEL;

var TopicSubscriber = function (solaceModule, topicName) {
    var solace = solaceModule;
    var subscriber = {};
    subscriber.session = null;
    subscriber.topicName = topic;
    subscriber.subscribed = false;

    // Logger
    subscriber.log = function (line) {
        var now = new Date();
        var time = [('0' + now.getHours()).slice(-2), ('0' + now.getMinutes()).slice(-2), ('0' + now.getSeconds()).slice(-2)];
        var timestamp = '[' + time.join(':') + '] ';
        console.log(timestamp + line);
    };

    subscriber.log('Ready to subscribe to ' + subscriber.topicName );

    // Main
    subscriber.run = function () {
        subscriber.connect();
    };

    // Connect to Solace
    subscriber.connect = function () {
        if (subscriber.session !== null) {
            subscriber.log('Already connected and ready to subscribe');
            return;
        }

        // Log connection details
        subscriber.log('Solace Connection Details')
        subscriber.log('URL     : ' + hosturl);
        subscriber.log('Username: ' + username);
        subscriber.log('VPN name: ' + vpn);

        // Create session
        try {
            subscriber.session = solace.SolclientFactory.createSession({
                url:      hosturl,
                vpnName:  vpn,
                userName: username,
                password: pass,
            });
        } catch (error) {
            subscriber.log(error.toString());
        }

        // Event listeners
        subscriber.session.on(solace.SessionEventCode.UP_NOTICE, function (sessionEvent) {
            subscriber.log('Successfully connected to Solace');
            subscriber.subscribe();
        });

        subscriber.session.on(solace.SessionEventCode.CONNECT_FAILED_ERROR, function (sessionEvent) {
            subscriber.log('Failed to connect to Solace: ' + sessionEvent.infoStr);
        });

        subscriber.session.on(solace.SessionEventCode.DISCONNECTED, function (sessionEvent) {
            subscriber.log('Disconnected');
            subscriber.subscribed = false;
            if (subscriber.session !== null) {
                subscriber.session.dispose();
                subscriber.session = null;
            }
        });

        subscriber.session.on(solace.SessionEventCode.SUBSCRIPTION_ERROR, function (sessionEvent) {
            subscriber.log('Cannot subscribe to topic ' + sessionEvent.correlationKey);
        });

        subscriber.session.on(solace.SessionEventCode.SUBSCRIPTION_OK, function (sessionEvent) {
            if (subscriber.subscribed) {
                subscriber.subscribed = false;
                subscriber.log('Successfully unsubscribed from topic ' + sessionEvent.correlationKey);
            } else {
                subscriber.subscribed = true;
                subscriber.log('Successfully subscribed to topic ' + sessionEvent.correlationKey);
                subscriber.log('Ready to receive messages');
            }
        });

        subscriber.session.on(solace.SessionEventCode.MESSAGE, function (message) {
            if (loglevel.toLocaleLowerCase() == 'debug' || loglevel.toLocaleLowerCase() == 'info') {
                subscriber.log('received message\n' + message.dump())
            }
            var data = message.getBinaryAttachment()

            var options = {
              hostname: targetHost,
              port: targetPort,
              path: targetPath,
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Content-Length": data.length,
              },
            }
            
            // Forward the webhook with headers to a new host
            var req = https.request(options)
            var messageHeaders = message.getUserPropertyMap().getKeys();
            messageHeaders.forEach(item => req.setHeader(updateHeaderName(item), message.getUserPropertyMap().getField(item).getValue()));
            req.write(data)
            req.end()
            
            // In order to be able to accept custom headers, your Solace instance has to be set to gateway mode.
            // With this setting the gateway uses a generated appMessageID for correlation between request and reply. 
            // The default session.sendReply() method takes the correlationID of the original message if you provide 
            // a message to reply to. In order to make sure the calling server doesn't receive a timeout (HTTP/504)
            // you have to set the appropriate destination and correlation ID headers manually.
            var reply = solace.SolclientFactory.createMessage();
            reply.setAsReplyMessage(true);
            reply.setDestination(message.getReplyTo());
            reply.setCorrelationId(message.getApplicationMessageId());
            subscriber.session.sendReply(null,reply)
        });

        // connect the session
        try {
            subscriber.session.connect();
        } catch (error) {
            subscriber.log(error.toString());
        }
    };

    // Subscribes to topic on Solace message router
    subscriber.subscribe = function () {
        if (subscriber.session !== null) {
            if (subscriber.subscribed) {
                subscriber.log('Already subscribed to ' + subscriber.topicName + ' and ready to receive messages');
            } else {
                subscriber.log('Subscribing to topic ' + subscriber.topicName);
                try {
                    // Create a subscriber that generates confirmation when subscription is added successfully and 
                    // has a 10 second timeout for this operation to complete
                    subscriber.session.subscribe(solace.SolclientFactory.createTopicDestination(subscriber.topicName), true, subscriber.topicName, 10000);
                } catch (error) {
                    subscriber.log(error.toString());
                }
            }
        } else {
            subscriber.log('Cannot subscribe because not connected to Solace message router');
        }
    };

    subscriber.exit = function () {
        subscriber.unsubscribe();
        subscriber.disconnect();
        setTimeout(function () {
            process.exit();
        }, 1000); // wait for 1 second to finish
    };

    // Unsubscribes from topic on Solace message router
    subscriber.unsubscribe = function () {
        if (subscriber.session !== null) {
            if (subscriber.subscribed) {
                subscriber.log('Unsubscribing from topic: ' + subscriber.topicName);
                try {
                    // Create a subscriber that generates confirmation when subscription is removed successfully and 
                    // has a 10 second timeout for this operation to complete
                    subscriber.session.unsubscribe(
                        solace.SolclientFactory.createTopicDestination(subscriber.topicName), true, subscriber.topicName, 10000);
                } catch (error) {
                    subscriber.log(error.toString());
                }
            } else {
                subscriber.log('Cannot unsubscribe because not subscribed to the topic ' + subscriber.topicName);
            }
        } else {
            subscriber.log('Cannot unsubscribe because not connected to Solace message router');
        }
    };

    // Gracefully disconnects from Solace message router
    subscriber.disconnect = function () {
        subscriber.log('Disconnecting from Solace message router');
        if (subscriber.session !== null) {
            try {
                subscriber.session.disconnect();
            } catch (error) {
                subscriber.log(error.toString());
            }
        } else {
            subscriber.log('Not connected to Solace message router');
        }
    };

    return subscriber;
};

// the function updateHeaderName strips off the prefixes to the HTTP headers added by
// Solace PubSub+ Cloud and transforms any that are deemed needed
function updateHeaderName(item) {
    item = item.replace('JMS_Solace_HTTP_target_path_query_verbatim','X-Request-Path')
    item = item.replace('JMS_Solace_HTTP_field_','')
    return item
}

// Initialize factory with the most recent API defaults
var factoryProps = new solace.SolclientFactoryProperties();
factoryProps.profile = solace.SolclientFactoryProfiles.version10;
solace.SolclientFactory.init(factoryProps);

// Set the log level based on the environment variable. This works
// only when the Solace client has '.debug' appended to it.
// require('solclientjs').debug
switch (loglevel.toLocaleLowerCase()) {
    case "trace":
        solace.SolclientFactory.setLogLevel(solace.LogLevel.TRACE);
        break;
    case "debug":
        solace.SolclientFactory.setLogLevel(solace.LogLevel.DEBUG);
        break;
    case "info":
        solace.SolclientFactory.setLogLevel(solace.LogLevel.INFO);
        break;
    case "warn":
        solace.SolclientFactory.setLogLevel(solace.LogLevel.WARN);
        break;
    case "error":
        solace.SolclientFactory.setLogLevel(solace.LogLevel.ERROR);
        break;
    default:
        solace.SolclientFactory.setLogLevel(solace.LogLevel.INFO);
}

// create the subscriber, specifying the name of the subscription topic
var subscriber = new TopicSubscriber(solace);

// subscribe to messages on Solace message router
subscriber.run(process.argv);

// wait to be told to exit
process.stdin.resume();

process.on('SIGINT', function () {
    subscriber.exit();
});