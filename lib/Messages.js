"use strict";

exports.MessageHeader = class MessageHeader {
    constructor() {
        this.id = 0;
        this.qr = 0;
        this.opcode = 0;
        this.aa = 0;
        this.tc = 0;
        this.rd = 0;
        this.ra = 0;
        this.z = 0;
        this.ad = 0;
        this.cd = 0;
        this.rcode = 0;
        this.qdcount = 0;
        this.ancount = 0;
        this.nscount = 0;
        this.arcount = 0;
    }
};

/** @typedef {number} ns_type_t */
/** @typedef {number} ns_class_t */

exports.MessageQuestion = class MessageQuestion {
    /**
     *
     * @param {string} name
     * @param {ns_type_t} type
     * @param {ns_class_t} klass
     */
    constructor(name, type, klass) {
        this.name = name;
        this.type = type;
        this.class = klass;
    }
};

exports.MessageRR = class MessageRR {
    /**
     *
     * @param {string} name
     * @param {ns_type_t} type
     * @param {ns_class_t} klass
     * @param {number} ttl
     * @param {Array<*>} [rdata]
     */
    constructor(name, type, klass, ttl, rdata = []) {
        this.name = name;
        this.type = type;
        this.class = klass;
        this.ttl = ttl;
        this.rdata = rdata;
    }
};
