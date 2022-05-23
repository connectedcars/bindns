//@ts-check

const {
    NS_MAXDNAME,
    NS_MAXMSG,

    ns_class,
    ns_sect,
    ns_type,
    ns_flag,
    ns_rcode,
    ns_opcode,
    ns_type_str,

    ns_msg,
    ns_newmsg,
    ns_rr2
} = require("./nameser.js");

exports.ns_class = ns_class;
exports.ns_sect = ns_sect;
exports.ns_type = ns_type;
exports.ns_type_str = ns_type_str;
exports.ns_flag = ns_flag;
exports.ns_rcode = ns_rcode;
exports.ns_opcode = ns_opcode;

const {
    ns_name_ntop,
    ns_name_pton
} = require("./ns_name.js");

const {
    ns_newmsg_init,
    ns_newmsg_done,
    ns_newmsg_q,
    ns_newmsg_rr
} = require("./ns_newmsg.js");

const {
    ns_initparse,
    ns_parserr2
} = require("./ns_parse.js");

const {
    ns_rdata_unpack,
    ns_rdata_pack
} = require("./ns_rdata.js");

const {
    MessageHeader,
    MessageQuestion,
    MessageRR
} = require("./Messages.js");

const debugLevel = Number.parseInt(process.env.NODE_DEBUG, 16);
const debug = debugLevel & 0x4 ? x => console.error("NDNS: " + x) : () => {};

const dgram = require("dgram");
const {EventEmitter} = require("events");

// Perf: reused objects
const _string = Buffer.alloc(NS_MAXDNAME);
const _dname = Buffer.alloc(NS_MAXDNAME);
const _msg = new ns_msg();
const _rr = new ns_rr2();
const _newmsg = new ns_newmsg();
const _rdata = Buffer.alloc(512);
const _maxmsg = Buffer.alloc(NS_MAXMSG);

class Message {
    constructor() {
        this.header = new MessageHeader();
        this.question = new Array();
        this.answer = new Array();
        this.authoritative = new Array();
        this.additional = new Array();
    }

    /**
     * Adds an RR to the message.
     * @param {number} sect An ns_sect value.
     * @param {string} name
     * @param {number} type An ns_type value.
     * @param {number} klass An ns_class value.
     * @param {number} ttl
     * @param {Array<string>} info
     */
    addRR(sect, name, type, klass, ttl, ...info) {
        let rr;
        if (sect === ns_sect.qd) {
            rr = new MessageQuestion(name, type, klass);
        } else {
            rr = new MessageRR(name, type, klass, ttl, info);
        }

        switch (sect) {
            case ns_sect.qd:
                this.question.push(rr);
                this.header.qdcount++;
                break;
            case ns_sect.an:
                this.answer.push(rr);
                this.header.ancount++;
                break;
            case ns_sect.ns:
                this.authoritative.push(rr);
                this.header.nscount++;
                break;
            case ns_sect.ar:
                this.additional.push(rr);
                this.header.arcount++;
                break;
        }
    }

    /**
     * @param {Buffer} buf
     * @private
     */
    parseOnce(buf) {
        if (ns_initparse(buf, buf.length, _msg) === -1)
            return false;

        this.header.id = _msg.getId();
        this.header.qr = _msg.getFlag(ns_flag.qr);
        this.header.opcode = _msg.getFlag(ns_flag.opcode);
        this.header.aa = _msg.getFlag(ns_flag.aa);
        this.header.tc = _msg.getFlag(ns_flag.tc);
        this.header.rd = _msg.getFlag(ns_flag.rd);
        this.header.ra = _msg.getFlag(ns_flag.ra);
        this.header.z = _msg.getFlag(ns_flag.a);
        this.header.ad = _msg.getFlag(ns_flag.ad);
        this.header.cd = _msg.getFlag(ns_flag.cd);
        this.header.rcode = _msg.getFlag(ns_flag.rcode);
        this.header.qdcount = _msg.getCount(ns_sect.qd);
        this.header.ancount = _msg.getCount(ns_sect.an);
        this.header.nscount = _msg.getCount(ns_sect.ns);
        this.header.arcount = _msg.getCount(ns_sect.ar);

        let len;
        for (let section = 0; section < ns_sect.max; section++) {
            for (let rrnum = 0; rrnum < _msg.getCount(section); rrnum++) {

                if (ns_parserr2(_msg, section, rrnum, _rr) === -1)
                    return false;
                if ((len = ns_name_ntop(_rr.nname, _dname, _dname.length)) === -1)
                    return false;

                const name = _dname.toString("ascii", 0, len);
                let rr;
                if (section === ns_sect.qd) {
                    rr = new MessageQuestion(name, _rr.type, _rr.rr_class);
                } else {
                    rr = new MessageRR(name, _rr.type, _rr.rr_class, _rr.ttl);
                    if (ns_rdata_unpack(buf, buf.length, _rr.type, _rr.rdata, _rr.rdlength, rr.rdata) === -1) return -1;
                }

                switch (section) {
                    case ns_sect.qd:
                        this.question.push(rr);
                        break;
                    case ns_sect.an:
                        this.answer.push(rr);
                        break;
                    case ns_sect.ns:
                        this.authoritative.push(rr);
                        break;
                    case ns_sect.ar:
                        this.additional.push(rr);
                        break;
                }
            }
        }
        return true;
    }

    /**
     * @param {Buffer} buf
     * @param {number} bufsiz
     * @private
     */
    writeOnce(buf, bufsiz) {
        if (ns_newmsg_init(buf, bufsiz, _newmsg) === -1)
            return -1;

        _newmsg.setId(this.header.id);
        _newmsg.setFlag(ns_flag.qr, this.header.qr);
        _newmsg.setFlag(ns_flag.opcode, this.header.opcode);
        _newmsg.setFlag(ns_flag.aa, this.header.aa);
        _newmsg.setFlag(ns_flag.tc, this.header.tc);
        _newmsg.setFlag(ns_flag.rd, this.header.rd);
        _newmsg.setFlag(ns_flag.ra, this.header.ra);
        _newmsg.setFlag(ns_flag.z, this.header.z);
        _newmsg.setFlag(ns_flag.ad, this.header.ad);
        _newmsg.setFlag(ns_flag.cd, this.header.cd);
        _newmsg.setFlag(ns_flag.rcode, this.header.rcode);

        for (let section = 0; section < ns_sect.max; section++) {
            let arr;
            switch (section) {
                case ns_sect.qd:
                    arr = this.question;
                    break;
                case ns_sect.an:
                    arr = this.answer;
                    break;
                case ns_sect.ns:
                    arr = this.authoritative;
                    break;
                case ns_sect.ar:
                    arr = this.additional;
                    break;
            }
            for (let rrnum = 0; rrnum < arr.length; rrnum++) {
                const rr = arr[rrnum];

                let len;
                if ((len = _string.write(rr.name, 0, rr.name.length, "ascii")) === _string.length)
                    return -1;
                _string[len] = 0;
                if (ns_name_pton(_string, _dname, _dname.length) === -1)
                    return -1;

                if (section === ns_sect.qd) {
                    if (ns_newmsg_q(_newmsg, _dname, rr.type, rr.class) === -1) {
                        return -1;
                    }
                } else {
                    let nrdata = 0;
                    if ((nrdata = ns_rdata_pack(rr.type, rr.rdata, _rdata, 0, _rdata.length)) === -1)
                        return -1;
                    if (ns_newmsg_rr(_newmsg, section, _dname, rr.type, rr.class, rr.ttl, nrdata, _rdata) === -1) {
                        return -1;
                    }
                }
            }
        }
        const n = ns_newmsg_done(_newmsg);
        return n;
    }

    /**
     * @param {dgram.Socket} socket
     * @param {number} port
     * @param {string} host
     */
    sendTo(socket, port, host) {
        let n;
        if ((n = this.writeOnce(_maxmsg, _maxmsg.length)) !== -1) {
            //hexdump (_maxmsg, n, 16);

            // I'm not certain if this copy is necessary. The comments in
            // https://github.com/nodejs/node/issues/26607 say that it is.
            const tmp = Buffer.allocUnsafe(n);
            for (let i = 0; i < n; i++)
                tmp[i] = _maxmsg[i];
            socket.send(tmp, port, host, (err, nbytes) => {
                if (err) debug(err);
            });
        }
    }
}
exports.Message = Message;

class ServerRequest extends Message {
    constructor(socket, rinfo) {
        super();
        this.socket = socket;
        this.rinfo = rinfo;
    }
}

class ServerResponse extends Message {
    constructor(req) {
        super();
        this.socket = req.socket;
        this.rinfo = req.rinfo;
        // edns
        for (let i = 0; i < req.answer.length; i++) {
            const rr = req.rr[i];
            if (rr.type !== ns_type.opt)
                continue;
            const extended_rcode = rr.rdata[0];
            const udp_payload_size = rr.rdata[1];
            const version = rr.rdata[2];
            const z = rr.rdata[3];
            if (version !== 0)
                continue; // only support edns0
            // useful in Message.prototype.sendTo
            this.edns = {
                extended_rcode,
                udp_payload_size,
                version,
                z
            };
        }
        // request and response id are equal
        this.header.id = req.header.id;
        // query type = answer
        this.header.qr = 1;
        // request and response rd bit are equal
        this.header.rd = req.header.rd;
        // request and response question sections are equal
        this.header.qdcount = req.header.qdcount;
        this.question = req.question;
    }

    send() {
        this.sendTo(this.socket, this.rinfo.port, this.rinfo.address);
    }
}

class Server extends EventEmitter {
    /**
     *
     * @param {"udp4"|"udp6"} type
     * @param {(req, res) => void} [requestListener]
     */
    constructor(type, requestListener) {
        super();
        try {
            this.socket = dgram.createSocket(type);
        } catch (e) {
            console.error(e);
        }
        if (requestListener) {
            this.on("request", requestListener);
        }
        this.socket.on("close", () => this.emit("close"));
        this.socket.on("error", e => this.emit("error", e));
        this.socket.on("listening", () => this.emit("listening"));
        this.socket.on("message", (msg, rinfo) => {
            debug("server_messageListener: new message");
            if (debugLevel & 0x4) debug(hexdump(msg, msg.length, 16));

            const req = new ServerRequest(this.socket, rinfo);

            if (req.parseOnce(msg)) {
                const res = new ServerResponse(req);
                this.emit("request", req, res);
            }
        });
    }

    bind(port, address) {
        this.socket.bind(port, address);
    }

    close() {
        this.socket.close();
    }
}
exports.Server = Server;

class ClientRequest extends Message {
    constructor(socket, rinfo) {
        super();
        this.socket = socket;
        this.rinfo = rinfo;
        this.header.id = Math.random() * 65536 | 0;
    }

    addQuestion(qname, qtype, qclass) {
        const q = new MessageQuestion(qname, qtype, qclass);
        this.question.push(q);
        this.header.qdcount++;
        return q;
    }

    send() {
        this.sendTo(this.socket, this.rinfo.port, this.rinfo.address);
    }
}
exports.ClientRequest = ClientRequest;

class ClientResponse extends Message {
    constructor(socket, rinfo) {
        super();
        this.socket = socket;
        this.rinfo = rinfo;
    }
}
exports.ClientResponse = ClientResponse;

class Client extends EventEmitter {
    constructor(type, responseListener) {
        super();
        this.socket = dgram.createSocket(type);
        this.callbacks = new Map();
        if (responseListener) {
            this.on("response", responseListener);
        }
        this.socket.on("message", (msg, rinfo) => {
            debug("client_messageListener: new message");
            if (debugLevel & 0x4) debug(hexdump(msg, msg.length, 16));

            const res = new ClientResponse(this.socket, rinfo);

            if (res.parseOnce(msg)) {
                const cb = this.callbacks.get(res.header.id);
                if (cb) cb(res);
                this.emit("response", res);
            }
        });
    }

    request(port, host, cb) {
        const req = new ClientRequest(this.socket, {address: host, port});
        this.callbacks.set(req.header.id, cb);
        return req;
    }

    bind(port, address) {
        this.socket.bind(port, address);
    }
}
exports.Client = Client;

/**
 * Debugging utility to print part of packet in hex.
 * @param {Buffer} buf
 * @param {number} length
 * @param {number} width Octets per line
 * @return {string}
 */
function hexdump(buf, length, width = 32) {
    if (!Buffer.isBuffer(buf))
        throw new Error("argument must be buffer");
    let str = "\n";
    str += "0";
    str += "\t";
    for (let i = 0; i < length; i++) {
        str += buf.toString("hex", i, i + 1);
        str += " ";
        if ((i + 1) % (width / 2)) continue;
        str += " ";
        if ((i + 1) % width) continue;
        str += "\n";
        str += String(i + 1);
        str += "\t";
    }
    return str;
}
