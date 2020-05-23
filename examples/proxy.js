"use strict";

const ndns = require("../lib/ndns");
const server = new ndns.Server("udp4");
const client = new ndns.Client("udp4");

const LOCAL_PORT = 53;
const REMOTE_HOST = "8.8.8.8";
const REMOTE_PORT = 53;

server.on("request", (req, res) => {
    const c_req = client.request(REMOTE_PORT, REMOTE_HOST, (err, c_res) => {
        if (err) throw err;
        res.header.aa = c_res.header.aa;
        res.header.rcode = c_res.header.rcode;

        for (const answer of c_res.answer) {
            res.addRR(ndns.ns_sect.an, answer.name, answer.type, answer.class, answer.ttl, ...answer.rdata);
            // or res.answer.push(answer);
        }

        for (const authoritative of c_res.authoritative) res.authoritative.push(authoritative);
        for (const additional of c_res.additional) res.additional.push(additional);

        res.send();
    });

    c_req.header.rd = 1; // Recursion desired
    for (const question of req.question) {
        c_req.addQuestion(question.name, question.type, question.class);
    }
    c_req.send();
});

server.bind(LOCAL_PORT);
client.bind();
