"use strict";

const ndns = require("../lib/ndns.js");
const server = new ndns.Server("udp4");
const BIND_PORT = 53;

const {ns_sect, ns_type, ns_class} = ndns;

server.on("request", (req, res) => {
    if (req.q && req.q.length > 0) {
        let name = req.q[0].name;
        if (name === ".") name = "";

        res.addRR(ns_sect.an, name, ns_type.soa, ns_class.in, 360,
            "hostmaster." + name, "hostmaster." + name, 1, 2, 3, 4, 5);

        res.addRR(ns_sect.an, name, ns_type.txt, ns_class.in, 10, "Hello World");

        res.addRR(ns_sect.an, name, ns_type.mx, ns_class.in, 10, "mail." + name);

        res.addRR(ns_sect.an, name, ns_type.ns, ns_class.in, 10, "ns1." + name);
        res.addRR(ns_sect.an, name, ns_type.ns, ns_class.in, 10, "ns2." + name);
        res.addRR(ns_sect.an, name, ns_type.ns, ns_class.in, 10, "ns3." + name);
        res.addRR(ns_sect.an, name, ns_type.ns, ns_class.in, 10, "ns4." + name);

        res.addRR(ns_sect.an, "mail." + name, ns_type.a, ns_class.in, 10, "127.0.0.1");
        res.addRR(ns_sect.an, "ns1." + name, ns_type.a, ns_class.in, 10, "127.0.0.1");
        res.addRR(ns_sect.an, "ns2." + name, ns_type.a, ns_class.in, 10, "127.0.0.2");
        res.addRR(ns_sect.an, "ns3." + name, ns_type.a, ns_class.in, 10, "127.0.0.3");
        res.addRR(ns_sect.an, "ns4." + name, ns_type.a, ns_class.in, 10, "127.0.0.4");
    }
    res.send();
});

server.bind(BIND_PORT);
