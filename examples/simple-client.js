//@ts-check
"use strict";

/**
 * An example of making an A request for "nodejs.org".
 */

const bindns = require("../lib/ndns.js");

// Set up the client.
const client = new bindns.Client();
client.on("error", console.error);
client.bind();

// Make a request to 8.8.8.8:53, which is one of Google's public DNS server IPs.
// To specify a timeout, use an options object:
// client.request({port: 53, address: "8.8.8.8", timeout: 5000}, (err, res) => ...
const req = client.request(53, "8.8.8.8", (err, res) => {
    // Currently only happens if the request times out.
    if (err)
        throw err;

    if (res.header.rcode !== 0)
        throw bindns.getRcodeError(res);

    // Typically the `answer` array is what's of interest, but `authoritative`
    // and `additional` may be too.
    console.log(res.answer);
    // Expected output:
    // [MessageRR {
    //   name: "nodejs.org",
    //   type: 1,
    //   class: 1,
    //   ttl: 152,
    //   rdata: [ "104.20.23.46" ]
    // }]

    // Close the underlying socket so that Node.js can exit.
    client.close();
});
// Query the A record for nodejs.org
req.addQuestion("nodejs.org", bindns.ns_type.a);
// Set Recursion Desired. This is generally desirable.
req.header.rd = 1;
req.send();
