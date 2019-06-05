# Webhook Forwarder

A [Solace](https://solace.com) PubSub+ Cloud subscriber to receive webhooks and forward them to an internal system.

## Prerequisites

In order to use this app, you'll need to have a [Solace](https://solace.com) PubSub+ Cloud account. If you don't have one, you can subscribe [here](https://solace.com/try-it-now/).

## Environment variables

The app, whether in Docker or running on your machine, requires a few environment variables to be set:

```javascript
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
```

## Run the app

Either use the [Dockerfile](./Dockerfile) to build a docker image, or use `node index.js` to run the app on your machine

## License

See the [LICENSE](./LICENSE) file in the repository
