"use strict";

const {
    errno,
    EMSGSIZE,
    ENODEV
} = require("./errno.js");

const {
    NS_INT16SZ,
    NS_INT32SZ,
    ns_sect
} = require("./nameser.js");

const Ptr = require("./Ptr.js");

const {
    ns_name_skip,
    ns_name_unpack2
} = require("./ns_name.js");

function dn_skipname(buf, ptr, eom) {
    const saveptr = ptr;
    const ptrptr = new Ptr(ptr);

    if (ns_name_skip(buf, ptrptr, eom) === -1) {
        return -1;
    }

    return ptrptr.get() - saveptr;
}

function ns_skiprr(buf, ptr, eom, section, count) {
    const optr = ptr;
    for (let i = 0; i < count; i++) {
        let rdlength;
        const b = dn_skipname(buf, ptr, eom);
        if (b < 0) {
            return -1;
        }
        ptr += b + NS_INT16SZ + NS_INT16SZ;
        if (section !== ns_sect.qd) {
            if (ptr + NS_INT32SZ + NS_INT16SZ > eom) return -1;
            ptr += NS_INT32SZ;
            rdlength = buf[ptr] * 256 + buf[ptr + 1];
            ptr += NS_INT16SZ;
            ptr += rdlength;
        }
    }
    if (ptr > eom) {
        errno(EMSGSIZE);
        return -1;
    }
    return ptr - optr;
}
exports.ns_skiprr = ns_skiprr;

function ns_initparse(buf, buflen, handle) {
    let msg = 0;
    const eom = buflen;
    let i;

    handle._buf = buf;
    handle._msg = 0;
    handle._eom = eom;

    if (msg + NS_INT16SZ > eom) return -1;
    handle._id = buf[msg] * 256 + buf[msg + 1];
    msg += NS_INT16SZ;

    if (msg + NS_INT16SZ > eom) return -1;
    handle._flags = buf[msg] * 256 + buf[msg + 1];
    msg += NS_INT16SZ;

    for (i = 0; i < ns_sect.max; i++) {
        if (msg + NS_INT16SZ > eom) return -1;
        handle._counts[i] = buf[msg] * 256 + buf[msg + 1];
        msg += NS_INT16SZ;
    }

    for (i = 0; i < ns_sect.max; i++) {
        if (handle._counts[i] === 0) {
            handle._sections[i] = null;
        } else {
            const b = ns_skiprr(buf, msg, eom, i, handle._counts[i]);
            if (b < 0) {
                return -1;
            }
            handle._sections[i] = msg;
            msg += b;
        }
    }

    if (msg !== eom) return -1;
    setsection(handle, ns_sect.max);
    return 0;
}
exports.ns_initparse = ns_initparse;


function ns_parserr2(handle, section, rrnum, rr) {
    let b;

    const tmp = section;
    if (tmp < 0 || section >= ns_sect.max) {
        errno(ENODEV);
        return -1;
    }
    if (section !== handle._sect) setsection(handle, section);

    if (rrnum === -1) rrnum = handle._rrnum;
    if (rrnum < 0 || rrnum >= handle._counts[section]) {
        errno(ENODEV);
        return -1;
    }
    if (rrnum < handle._rrnum) setsection(handle, section);
    if (rrnum > handle._rrnum) {
        b = ns_skiprr(handle._buf, handle._msg_ptr, handle._eom, section, rrnum - handle._rrnum);
        if (b < 0) return -1;
        handle._msg_ptr += b;
        handle._rrnum = rrnum;
    }
    // do the parse
    const nnamelp = new Ptr();
    b = ns_name_unpack2(handle._buf, handle._msg_ptr, handle._eom, rr.nname, rr.nname.length, nnamelp);
    if (b < 0) return -1;
    rr.nnamel = nnamelp.get();
    handle._msg_ptr += b;
    if (handle._msg_ptr + NS_INT16SZ + NS_INT16SZ > handle._eom) {
        errno(EMSGSIZE);
        return -1;
    }
    rr.type = handle._buf[handle._msg_ptr] * 256 + handle._buf[handle._msg_ptr + 1];
    handle._msg_ptr += NS_INT16SZ;
    rr.rr_class = handle._buf[handle._msg_ptr] * 256 + handle._buf[handle._msg_ptr + 1];
    handle._msg_ptr += NS_INT16SZ;
    if (section === ns_sect.qd) {
        rr.ttl = 0;
        rr.rdlength = 0;
        rr.rdata = null;
    } else {
        if (handle._msg_ptr + NS_INT32SZ + NS_INT16SZ > handle._eom) {
            errno(EMSGSIZE);
            return -1;
        }
        rr.ttl = handle._buf[handle._msg_ptr] * 16777216 +
            handle._buf[handle._msg_ptr + 1] * 65536 +
            handle._buf[handle._msg_ptr + 2] * 256 +
            handle._buf[handle._msg_ptr + 3];
        handle._msg_ptr += NS_INT32SZ;
        rr.rdlength = handle._buf[handle._msg_ptr] * 256 + handle._buf[handle._msg_ptr + 1];
        handle._msg_ptr += NS_INT16SZ;
        if (handle._msg_ptr + rr.rdlength > handle._eom) {
            errno(EMSGSIZE);
            return -1;
        }
        rr.rdata = handle._msg_ptr;
        handle._msg_ptr += rr.rdlength;
    }
    if (++handle._rrnum > handle._counts[section]) setsection(handle, section + 1);

    // all done
    return 0;
}
exports.ns_parserr2 = ns_parserr2;

/**
 *
 * @param {*} msg
 * @param {number} sect an ns_sect value
 */
function setsection(msg, sect) {
    msg._sect = sect;
    if (sect === ns_sect.max) {
        msg._rrnum = -1;
        msg._msg_ptr = null;
    } else {
        msg._rrnum = 0;
        msg._msg_ptr = msg._sections[sect];
    }
}
