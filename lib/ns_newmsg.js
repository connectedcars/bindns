const {
    NS_HFIXEDSZ,
    NS_QFIXEDSZ,
    NS_RRFIXEDSZ,
    NS_INT16SZ,
    NS_INT32SZ,

    ns_type,
    ns_sect,

    ns_newmsg
} = require("./nameser.js");

const {
    errno,
    ENODEV,
    EMSGSIZE
} = require("./errno.js");

const {
    ns_name_pack,
    ns_name_skip
} = require("./ns_name.js");

const copy = require("./copy.js");

const Ptr = require("./Ptr.js");

// Faster version of arr.fill, for small fills.
function fill(buf, val) {
    for (let i = 0; i < buf.length; i++) buf[i] = val;
}

/**
 * Initialize a "newmsg" object to empty.
 * @todo just do this in the ctor.
 * @param {Buffer} buf
 * @param {number} bufsiz
 * @param {ns_newmsg} handle
 */
function ns_newmsg_init(buf, bufsiz, handle) {
    const msg = handle.msg;
    msg._buf = buf;
    msg._msg = null;
    msg._eom = bufsiz;
    msg._id = 0;
    msg._flags = 0;
    fill(msg._counts, 0);
    fill(msg._sections, 0);
    msg._sect = ns_sect.qd;
    msg._rrnum = 0;
    msg._msg_ptr = 0 + NS_HFIXEDSZ;

    handle.dnptrs[0] = 0;
    handle.dnptrs[1] = null;
    handle.lastdnptr = handle.dnptrs.length;

    return 0;
}
exports.ns_newmsg_init = ns_newmsg_init;

/**
 * Add a question (or zone, if it's an update) to a "newmsg" object.
 * @param {ns_newmsg} handle
 * @param {Buffer} qname
 * @param {number} qtype
 * @param {number} qclass
 */
function ns_newmsg_q(handle, qname, qtype, qclass) {
    const msg = handle.msg;
    let t;

    if (msg._sect !== ns_sect.qd) {
        errno(ENODEV);
        return -1;
    }

    t = msg._msg_ptr;
    if (msg._rrnum === 0) {
        msg._sections[ns_sect.qd] = t;
    }
    const n = ns_name_pack(qname, 0, msg._buf, t, msg._eom - t, handle.dnptrs, handle.lastdnptr);
    if (n < 0) return -1;
    t += n;
    if (t + NS_QFIXEDSZ >= msg._eom) {
        errno(EMSGSIZE);
        return -1;
    }
    msg._buf[t++] = qtype >> 8;
    msg._buf[t++] = qtype >> 0;
    msg._buf[t++] = qclass >> 8;
    msg._buf[t++] = qclass >> 0;
    msg._msg_ptr = t;
    msg._counts[ns_sect.qd] = ++msg._rrnum;
    return 0;
}
exports.ns_newmsg_q = ns_newmsg_q;

/** @typedef {number} ns_sect_t */
/** @typedef {number} ns_type_t */
/** @typedef {number} ns_class_t */

/**
 * Add an RR to a "newmsg" object.
 * @param {ns_newmsg} handle
 * @param {ns_sect_t} sect
 * @param {*} name
 * @param {ns_type_t} type
 * @param {ns_class_t} rr_class
 * @param {number} ttl
 * @param {number} rdlen
 * @param {Buffer} rdata
 */
function ns_newmsg_rr(handle, sect, name, type, rr_class, ttl, rdlen, rdata) {
    const msg = handle.msg;
    let t;

    if (!Buffer.isBuffer(rdata)) {
        throw new Error("error");
    }

    if (sect < msg._sect) {
        errno(ENODEV);
        return -1;
    }
    t = msg._msg_ptr;
    if (sect > msg._sect) {
        msg._sect = sect;
        msg._sections[sect] = t;
        msg._rrnum = 0;
    }
    const n = ns_name_pack(name, 0, msg._buf, t, msg._eom - t, handle.dnptrs, handle.lastdnptr);
    if (n < 0) return -1;
    t += n;
    if (t + NS_RRFIXEDSZ + rdlen > msg._eom) {
        errno(EMSGSIZE);
        return -1;
    }
    msg._buf[t++] = type >> 8;
    msg._buf[t++] = type >> 0;
    msg._buf[t++] = rr_class >> 8;
    msg._buf[t++] = rr_class >> 0;
    msg._buf[t++] = ttl >> 24;
    msg._buf[t++] = ttl >> 16;
    msg._buf[t++] = ttl >> 8;
    msg._buf[t++] = ttl >> 0;
    msg._msg_ptr = t;
    if (rdcpy(handle, type, rdata, rdlen) < 0) return -1;
    msg._counts[sect] = ++msg._rrnum;
    return 0;
}
exports.ns_newmsg_rr = ns_newmsg_rr;

function ns_newmsg_done(handle) {
    const msg = handle.msg;
    let t = 0;
    msg._buf[t++] = msg._id >> 8;
    msg._buf[t++] = msg._id >> 0;
    msg._buf[t++] = msg._flags >> 8;
    msg._buf[t++] = msg._flags >> 0;
    for (let sect = 0; sect < ns_sect.max; sect++) {
        msg._buf[t++] = msg._counts[sect] >> 8;
        msg._buf[t++] = msg._counts[sect] >> 0;
    }
    msg._eom = msg._msg_ptr;
    msg._sect = ns_sect.max;
    msg._rrnum = -1;
    msg._msg_ptr = null;

    return msg._eom;
}
exports.ns_newmsg_done = ns_newmsg_done;

const _ptr = new Ptr();

/**
 * Copy an RDATA, using compression pointers where RFC1035 permits.
 * @param handle
 * @param {number} type
 * @param {Buffer} rdata
 * @param {number} rdlen
 */
function rdcpy(handle, type, rdata, rdlen) {
    const msg = handle.msg;

    let p = msg._msg_ptr;
    let t = p + NS_INT16SZ;
    const s = t;
    let n;

    let nrdata = 0;

    switch (type) {
        case ns_type.soa:
            n = ns_name_pack(rdata, nrdata, msg._buf, t, msg._eom - t, handle.dnptrs, handle.lastdnptr);
            if (n < 0) return -1;
            t += n;

            _ptr.set(nrdata);
            if (ns_name_skip(rdata, _ptr, msg._eom) < 0) return -1;
            nrdata = _ptr.get();

            n = ns_name_pack(rdata, nrdata, msg._buf, t, msg._eom - t, handle.dnptrs, handle.lastdnptr);
            if (n < 0) return -1;
            t += n;

            _ptr.set(nrdata);
            if (ns_name_skip(rdata, _ptr, msg._eom) < 0) return -1;
            nrdata = _ptr.get();

            if (msg._eom - t < NS_INT32SZ * 5) {
                errno(EMSGSIZE);
                return -1;
            }
            copy(rdata, msg._buf, t, nrdata, nrdata + NS_INT32SZ * 5);
            t += NS_INT32SZ * 5;
            /*
            rdata.copy (msg._buf, t, nrdata, rdlen);
            t += rdlen;
            */
            break;
        case ns_type.ptr:
        case ns_type.cname:
        case ns_type.ns:
            n = ns_name_pack(rdata, nrdata, msg._buf, t, msg._eom - t, handle.dnptrs, handle.lastdnptr);
            if (n < 0) return -1;
            t += n;
            break;
        default:
            copy(rdata, msg._buf, t, nrdata, rdlen);
            t += rdlen;
            break;
    }

    msg._buf[p++] = t - s >> 8;
    msg._buf[p++] = t - s >> 0;
    msg._msg_ptr = t;
    return 0;
}
