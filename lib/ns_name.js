//@ts-check
"use strict";

const Ptr = require("./Ptr.js");

const {
    errno,
    EMSGSIZE,
    EINVAL,
    EISDIR,
    ENOENT,
    ENAMETOOLONG
} = require("./errno.js");

const {
    NS_MAXCDNAME,
    NS_CMPRSFLGS
} = require("./nameser.js");

const copy = require("./copy.js");

const DNS_LABELTYPE_BITSTRING = 0x41;
const NS_TYPE_ELT = 0x40; // edns0 extended label type

const digits = "0123456789";

const digitvalue = [
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 16
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 32
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 48
    0,   1,  2,  3,  4,  5,  6,  7,  8,  9, -1, -1, -1, -1, -1, -1, // 64
    -1, 10, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 80
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 96
    -1, 12, 11, 12, 13, 14, 15, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 112
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 128
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1,
    -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, // 256
];

/**
 * @typedef {{base: number, len: number}} map_t
 */

/**
 * Convert an encoded domain name to printable ascii as per RFC1035. The root is
 * returned as ".". All other domains are returned in non absolute form.
 * @param {Buffer} src
 * @param {Buffer} dst
 * @param {number} dstsiz
 * @return {number} Number of bytes written to buffer, or -1 (with errno set).
 */
function ns_name_ntop(src, dst, dstsiz) {
    let cp = 0;
    let dn = 0;
    const eom = dstsiz;
    let c;
    let n;
    let l;

    while ((n = src[cp++]) !== 0) {
        if ((n & NS_CMPRSFLGS) === NS_CMPRSFLGS) {
            /* some kind of compression pointer */
            errno(EMSGSIZE);
            return -1;
        }
        if (dn !== 0) {
            if (dn >= eom) {
                errno(EMSGSIZE);
                return -1;
            }
            dst[dn++] = 0x2e; /* "." */
        }
        if ((l = labellen(src, cp - 1)) < 0) {
            errno(EMSGSIZE);
            return -1;
        }
        if (dn + l >= eom) {
            errno(EMSGSIZE);
            return -1;
        }
        if ((n & NS_CMPRSFLGS) === NS_TYPE_ELT) {
            let m;

            if (n !== DNS_LABELTYPE_BITSTRING) {
                /* XXX: labellen should reject this case */
                errno(EINVAL);
                return -1;
            }
            const cpp = new Ptr(cp);
            if ((m = decode_bitstring(src, cpp, dst, dn, eom)) < 0) {
                errno(EMSGSIZE);
                return -1;
            }
            cp = cpp.get();
            dn += m;
            continue;
        }
        for (; l > 0; l--) {
            c = src[cp++];
            if (special(c)) {
                if (dn + 1 >= eom) {
                    errno(EMSGSIZE);
                    return -1;
                }
                dst[dn++] = 0x5c; /* "\\" */
                dst[dn++] = c;
            } else if (!printable(c)) {
                if (dn + 3 >= eom) {
                    errno(EMSGSIZE);
                    return -1;
                }
                dst[dn++] = 0x5c; /* "\\" */
                // TODO(perf): no need to use charCodeAt, instead store array
                // of codes.
                dst[dn++] = digits[c / 100 | 0].charCodeAt(0);
                dst[dn++] = digits[c % 100 / 10 | 0].charCodeAt(0);
                dst[dn++] = digits[c % 10].charCodeAt(0);
            } else {
                if (dn >= eom) {
                    errno(EMSGSIZE);
                    return -1;
                }
                dst[dn++] = c;
            }
        }
    }
    if (dn === 0) {
        if (dn >= eom) {
            errno(EMSGSIZE);
            return -1;
        }
        dst[dn++] = 0x2e; // "."
    }
    if (dn >= eom) {
        errno(EMSGSIZE);
        return -1;
    }
    dst[dn] = 0;
    return dn;
}
exports.ns_name_ntop = ns_name_ntop;

/**
 * Convert a ascii string into an encoded domain name as per RFC1035. Enforces
 * label and domain length limits.
 * @param {Buffer} src
 * @param {Buffer} dst
 * @param {number} dstsiz
 * @return {number} -1 if it fails, 1 if string was fully qualified, 0 if string
 * was not fully qualified.
 */
function ns_name_pton(src, dst, dstsiz) {
    return ns_name_pton2(src, dst, dstsiz, null);
}
exports.ns_name_pton = ns_name_pton;

/**
 * Convert a ascii string into an encoded domain name as per RFC1035. Enforces
 * label and domain length limits. Side effect: fills in *dstlen (if non-NULL).
 * @param {Buffer} src
 * @param {Buffer} dst
 * @param {number} dstsiz
 * @param {Ptr} dstlenp
 * @return {number} -1 if it fails, 1 if string was fully qualified, 0 if string
 * was not fully qualified.
 */
function ns_name_pton2(src, dst, dstsiz, dstlenp) {
    let c, n;
    let cp;
    let e = 0;
    let escaped = 0;
    let bp = 0;
    const eom = dstsiz;
    let label = bp++;

    let srcn = 0;
    let done = false; // instead of goto
    while ((c = src[srcn++]) !== 0) {
        if (escaped) {
            if (c === 91) { // "["; start a bit string label
                if ((cp = strchr(src, srcn, 93)) === null) { // "]"
                    errno(EINVAL);
                    return -1;
                }
                const srcp = new Ptr(srcn);
                const bpp = new Ptr(bp);
                const labelp = new Ptr(label);
                e = encode_bitstring(src, srcp, cp + 2, labelp, dst, bpp, eom);
                if (e !== 0) {
                    errno(e);
                    return -1;
                }
                label = labelp.get();
                bp = bpp.get();
                srcn = srcp.get();
                escaped = 0;
                label = bp++;
                if ((c = src[srcn++]) === 0) {
                    done = true;
                    break;
                }
            } else if ((cp = digits.indexOf(String.fromCharCode(c))) !== -1) {
                n = cp * 100;
                if ((c = src[srcn++]) ||
                    (cp = digits.indexOf(String.fromCharCode(c))) === -1) {
                    errno(EMSGSIZE);
                    return -1;
                }
                n += cp * 10;
                if ((c = src[srcn++]) === 0 ||
                    (cp = digits.indexOf(String.fromCharCode(c))) === -1) {
                    errno(EMSGSIZE);
                    return -1;
                }
                n += cp;
                if (n > 255) {
                    errno(EMSGSIZE);
                    return -1;
                }
                c = n;
            }
            escaped = 0;
        } else if (c === 92) { // "\\"
            escaped = 1;
            continue;
        } else if (c === 46) { // "."
            c = bp - label - 1;
            if ((c & NS_CMPRSFLGS) !== 0) { // label too big
                errno(EMSGSIZE);
                return -1;
            }
            if (label >= eom) {
                errno(EMSGSIZE);
                return -1;
            }
            dst[label] = c;
            // Fully qualified?
            if (src[srcn] === 0) {
                if (c !== 0) {
                    if (bp >= eom) {
                        errno(EMSGSIZE);
                        return -1;
                    }
                    dst[bp++] = 0;
                }
                if (bp > NS_MAXCDNAME) {
                    errno(EMSGSIZE);
                    return -1;
                }
                if (dstlenp !== null) {
                    dstlenp.set(bp);
                }
                return 1;
            }
            if (c === 0 || src[srcn] === 46) { // "."
                errno(EMSGSIZE);
                return -1;
            }
            label = bp++;
            continue;
        }
        if (bp >= eom) {
            errno(EMSGSIZE);
            return -1;
        }
        dst[bp++] = c;
    }
    if (!done) {
        c = bp - label - 1;
        if ((c & NS_CMPRSFLGS) !== 0) {
            errno(EMSGSIZE);
            return -1;
        }
    }
    // done:
    if (label >= eom) {
        errno(EMSGSIZE);
        return -1;
    }
    dst[label] = c;
    if (c !== 0) {
        if (bp >= eom) {
            errno(EMSGSIZE);
            return -1;
        }
        dst[bp++] = 0;
    }
    if (bp > NS_MAXCDNAME) { // src too big
        errno(EMSGSIZE);
        return -1;
    }
    if (dstlenp !== null) {
        dstlenp.set(bp);
    }
    return 0;
}
exports.ns_name_pton2 = ns_name_pton2;

/**
 * Returns the position of the first occurrence of `c` in the null-terminated
 * string `src`.
 * @param {Buffer} src
 * @param {number} off
 * @param {number} c
 */
function strchr(src, off, c) {
    while (off < src.length && src[off] !== 0) {
        if (src[off] === c) return off;
        off++;
    }
    return null;
}

/**
 * Unpack a domain name from a message, source may be compressed.
 * @param {Buffer} msg
 * @param {number} offset
 * @param {number} len
 * @param {Buffer} dst
 * @param {number} dstsiz
 * @return {number} -1 if it fails, or consumed octets if it succeeds.
 */
function ns_name_unpack(msg, offset, len, dst, dstsiz) {
    return ns_name_unpack2(msg, offset, len, dst, dstsiz, null);
}
exports.ns_name_unpack = ns_name_unpack;

/**
 * Unpack a domain name from a message, source may be compressed. Side effect:
 * fills in *dstlen (if non-NULL).
 * @param {Buffer} msg
 * @param {number} offset
 * @param {number} len
 * @param {Buffer} dst
 * @param {number} dstsiz
 * @param {Ptr} dstlenp
 * @return {number} -1 if it fails, or consumed octets if it succeeds.
 */
function ns_name_unpack2(msg, offset, len, dst, dstsiz, dstlenp) {
    let n, l;

    let llen = -1;
    let checked = 0;
    let dstn = 0;
    let srcn = offset;
    const dstlim = dstsiz;
    const eom = offset + len;
    if (srcn < 0 || srcn >= eom) {
        errno(EMSGSIZE);
        return -1;
    }
    /* Fetch next label in domain name */
    while ((n = msg[srcn++]) !== 0 && !isNaN(srcn)) {
        /* Check for indirection */
        switch (n & NS_CMPRSFLGS) {
            case 0:
            case NS_TYPE_ELT:
                /* Limit checks */

                if ((l = labellen(msg, srcn - 1)) < 0) {
                    errno(EMSGSIZE);
                    return -1;
                }
                if (dstn + l + 1 >= dstlim || srcn + l >= eom) {
                    errno(EMSGSIZE);
                    return -1;
                }
                checked += l + 1;
                dst[dstn++] = n;
                copy(msg, dst, dstn, srcn, srcn + l);
                dstn += l;
                srcn += l;
                break;

            case NS_CMPRSFLGS:
                if (srcn >= eom) {
                    errno(EMSGSIZE);
                    return -1;
                }
                if (llen < 0) {
                    llen = srcn - offset + 1;
                }

                srcn = (n & 0x3F) * 256 | msg[srcn] & 0xFF;

                if (srcn < 0 || srcn >= eom) { /* Out of range */
                    errno(EMSGSIZE);
                    return -1;
                }

                checked += 2;
                /* check for loops in compressed name */
                if (checked >= eom) {
                    errno(EMSGSIZE);
                    return -1;
                }
                break;

            default:
                errno(EMSGSIZE);
                return -1; // flag error
        }
    }
    dst[dstn] = 0;
    if (dstlenp !== null)
        dstlenp.set(dstn);
    if (llen < 0)
        llen = srcn - offset;
    return llen;
}
exports.ns_name_unpack2 = ns_name_unpack2;

/**
 * Pack domain name `domain` into `comp_dn`.
 *
 * Side effects: The list of pointers in dnptrs is updated for labels inserted
 * into the message as we compress the name. If `dnptr` is `NULL`, we don't try
 * to compress names. If `lastdnptr` is `NULL`, we don't update the list.
 * @param {Buffer} src
 * @param {number} srcn
 * @param {Buffer} dst
 * @param {number} dstn
 * @param {number} dstsiz
 * @param {Array<number>} dnptrs An array of pointers to previous compressed
 * names. dnptrs[0] is a pointer to the beginning of the message. The array ends
 * with `NULL`.
 * @param {number} lastdnptr a pointer to the end of the array pointed to by
 * `dnptrs`.
 * @return {number} Size of the compressed name, or -1.
 */
function ns_name_pack(src, srcn, dst, dstn, dstsiz, dnptrs, lastdnptr) {
    /** @type {number} */
    let dstp;
    /** @type {number} */
    let cpp;
    /** @type {number} */
    let lpp;
    /** @type {Buffer} */
    let msg;
    /** @type {number} */
    let srcp;
    let n, l, first = 1;

    srcp = srcn;
    dstp = dstn;
    const eob = dstp + dstsiz;
    lpp = cpp = null;
    let ndnptr = 0;
    if (dnptrs !== null) {
        msg = dst;
        if (dnptrs[ndnptr++] !== null) {
            for (cpp = 0; dnptrs[cpp] !== null; cpp++);
            // This evil body-less loop is as it appears in ns_name.c. -ZB
            lpp = cpp; // end of list to search
        }
    } else
        msg = null;

    // make sure the domain we are about to add is legal
    l = 0;
    do {
        let l0;

        n = src[srcp];
        if ((n & NS_CMPRSFLGS) === NS_CMPRSFLGS) {
            errno(EMSGSIZE);
            return -1;
        }
        if ((l0 = labellen(src, srcp)) < 0) {
            errno(EINVAL);
            return -1;
        }
        l += l0 + 1;
        if (l > NS_MAXCDNAME) {
            errno(EMSGSIZE);
            return -1;
        }
        srcp += l0 + 1;
    } while (n !== 0);

    // from here on we need to reset compression pointer array on error
    srcp = srcn;
    let cleanup = false; // instead of goto
    do {
        // look to see if we can use pointers
        n = src[srcp];
        if (n !== 0 && msg !== null) {
            l = dn_find(src, srcp, msg, dnptrs, ndnptr, lpp);
            if (l >= 0) {
                if (dstp + 1 >= eob) {
                    cleanup = true;
                    break;
                }
                dst[dstp++] = l >> 8 | NS_CMPRSFLGS;
                dst[dstp++] = l & 0xff;
                return dstp - dstn;
            }
            // Not found, save it.
            if (lastdnptr !== null && cpp < lastdnptr - 1 &&
                dstp < 0x4000 && first) {
                dnptrs[cpp++] = dstp;
                dnptrs[cpp++] = null;
                first = 0;
            }
        }
        // copy label to buffer
        if ((n & NS_CMPRSFLGS) === NS_CMPRSFLGS) {
            // should not happen
            cleanup = true;
            break;
        }
        n = labellen(src, srcp);
        if (dstp + 1 + n >= eob) {
            cleanup = true;
            break;
        }
        copy(src, dst, dstp, srcp, srcp + (n + 1));
        srcp += n + 1;
        dstp += n + 1;

    } while (n !== 0);

    if (dstp > eob ||
        // cleanup:
        cleanup) {
        if (msg !== null) {
            dnptrs[lpp] = null;
        }
        errno(EMSGSIZE);
        return -1;
    }
    return dstp - dstn;
}
exports.ns_name_pack = ns_name_pack;

/**
 * Expand compressed domain name to presentation format. Note: root domain
 * returns as "." not "".
 * @param {Buffer} msg
 * @param {number} offset
 * @param {number} len
 * @param {Buffer} dst
 * @param {number} dstsiz
 * @return {number} Number of bytes read out of `src`, or -1 (with errno set).
 */
function ns_name_uncompress(msg, offset, len, dst, dstsiz) {
    let n;
    const tmp = Buffer.alloc(NS_MAXCDNAME);
    if ((n = ns_name_unpack(msg, offset, len, tmp, tmp.length)) === -1) return -1;
    if (ns_name_ntop(tmp, dst, dstsiz) === -1) return -1;
    return n;
}
exports.ns_name_uncompress = ns_name_uncompress;

/**
 * Advance `ptrptr` to skip over the compressed name it points at.
 * @param {Buffer} b
 * @param {Ptr} ptrptr
 * @param {number} eom
 * @return {number} 0 on success, -1 (with errno set) on failure.
 */
function ns_name_skip(b, ptrptr, eom) {
    let cp;
    let n;
    let l;
    cp = ptrptr.get();
    while (cp < eom && (n = b[cp++]) !== 0) {
        switch (n & NS_CMPRSFLGS) {
            case 0: // normal case, n === len
                cp += n;
                continue;
            case NS_TYPE_ELT: // edns0 extended label
                if ((l = labellen(b, cp - 1)) < 0) {
                    errno(EMSGSIZE);
                    return -1;
                }
                cp += l;
                continue;
            case NS_CMPRSFLGS: // indirection
                cp++;
                break;
            default: // illegal type
                errno(EMSGSIZE);
                return -1;
        }
        break;
    }
    if (cp > eom) {
        errno(EMSGSIZE);
        return -1;
    }
    ptrptr.set(cp);
    return 0;
}
exports.ns_name_skip = ns_name_skip;

/**
 * Find the number of octets an nname takes up, including the root label. (This
 * is basically ns_name_skip() without compression-pointer support.) (NOTE: can
 * only return zero if passed-in namesiz argument is zero.)
 * @param {Buffer} b
 * @param {number} nname
 * @param {number} namesiz
 * @return {number}
 */
function ns_name_length(b, nname, namesiz) {
    const orig = nname;
    let n;

    while (namesiz-- > 0 && (n = b[nname++]) !== 0) {
        if ((n & NS_CMPRSFLGS) !== 0) {
            return -1;
        }
        if (n > namesiz) {
            return -1;
        }
        nname += n;
        namesiz -= n;
    }
    return nname - orig;
}
exports.ns_name_length = ns_name_length;

function strncasecmp(buf1, s1, buf2, s2, n) {
    for (let i = 0; i < n; i++) {
        if ((buf1[s1 + i] | 0x20) !== (buf2[s2 + i] | 0x20)) {
            return -1;
        }
    }
    return 0;
}

/**
 * Compare two nnames for equality.
 * @param {Buffer} bufa
 * @param {number} a
 * @param {number} as
 * @param {Buffer} bufb
 * @param {number} b
 * @param {number} bs
 * @return {number} Return -1 on error (setting errno).
 */
function ns_name_eq(bufa, a, as, bufb, b, bs) {
    const ae = a + as, be = b + bs;
    let ac, bc;
    while (ac = bufa[a], bc = bufb[b], ac !== 0 && bc !== 0) {
        if ((ac & NS_CMPRSFLGS) !== 0 || (bc & NS_CMPRSFLGS) !== 0) {
            errno(EISDIR);
            return -1;
        }
        if (a + ac >= ae || b + bc >= be) {
            errno(EMSGSIZE);
            return -1;
        }
        if (ac !== bc || strncasecmp(bufa, ++a,
            bufb, ++b, ac) !== 0) {
            return 0;
        }
        a += ac, b += bc;
    }
    return Number(ac === 0 && bc === 0);
}
exports.ns_name_eq = ns_name_eq;

/**
 * Is domain "A" owned by (at or below) domain "B"?
 * @param {Buffer} bufa
 * @param {map_t} mapa
 * @param {number} an
 * @param {Buffer} bufb
 * @param {map_t} mapb
 * @param {number} bn
 * @return {number}
 */
function ns_name_owned(bufa, mapa, an, bufb, mapb, bn) {
    // If A is shorter, it cannot be owned by B.
    if (an < bn)
        return 0;

    // If they are unequal before the length of the shorter, A cannot...
    let a = 0, b = 0;
    while (bn > 0) {
        if (mapa[a].len !== mapa[b].len ||
            strncasecmp(bufa, mapa[a].base, bufb, mapb[b].base, mapa[a].len)) {
            return 0;
        }
        a++ , an--;
        b++ , bn--;
    }

    // A might be longer or not, but either way, B owns it.
    return 1;
}
exports.ns_name_owned = ns_name_owned;

/**
 * Build an array of <base, len> tuples from an nname, top-down order.
 * @param {Buffer} b
 * @param {number} nname
 * @param {number} namelen
 * @param {*} map `ns_namemap_t`
 * @param {number} mapsize
 * @return {number} the number of tuples (labels) thus discovered.
 */
function ns_name_map(b, nname, namelen, map, mapsize) {
    const n = b[nname++];
    namelen--;

    /* root zone? */
    if (n === 0) {
        /* extra data follows name? */
        if (namelen > 0) {
            errno(EMSGSIZE);
            return -1;
        }
        return 0;
    }
    /* compression pointer? */
    if ((n & NS_CMPRSFLGS) !== 0) {
        errno(EISDIR);
        return -1;
    }

    /* label too long? */
    if (n > namelen) {
        errno(EMSGSIZE);
        return -1;
    }

    /* recurse to get rest of name done first */
    const l = ns_name_map(b, nname + n, namelen - n, map, mapsize);
    if (l < 0) {
        return -1;
    }

    /* too many labels? */
    if (l >= mapsize) {
        errno(ENAMETOOLONG);
        return -1;
    }

    map.buf = b;
    /* we're on our way back up-stack, store current map data */
    /** @type {map_t} */
    const mapl = {
        base: nname,
        len: n
    };
    map[l] = mapl;
    return l + 1;
}
exports.ns_name_map = ns_name_map;

/**
 * Count the number of labels in a domain name. Root counts, so COM. has two.
 * This is to make the result comparable to the result of ns_name_map().
 * @param {*} b
 * @param {*} nname
 * @param {number} namesiz
 * @return {number}
 */
function ns_name_labels(b, nname, namesiz) {
    let ret = 0;
    let n;

    while (namesiz-- > 0 && (n = b[nname++]) !== 0) {
        if ((n & NS_CMPRSFLGS) !== 0) {
            errno(EISDIR);
            return -1;
        }
        if (n > namesiz) {
            errno(EMSGSIZE);
            return -1;
        }
        nname += n;
        namesiz -= n;
        ret++;
    }
    return ret + 1;
}
exports.ns_name_labels = ns_name_labels;

/**
 * Thinking in noninternationalized USASCII (per the DNS spec), is the character
 * special ("in need to quoting")?
 * @param {number} ch
 * @return {boolean}
 * @private
 */
function special(ch) {
    switch (ch) {
        case 0x22: /* """ */
        case 0x2E: /* "." */
        case 0x3B: /* ";" */
        case 0x5C: /* "\\" */
        case 0x28: /* "(" */
        case 0x29: /* ")" */
        case 0x40: /* "@" */ // special modifiers in the zone file
        case 0x24: /* "$" */ // special modifiers in the zone file
            return true;
        default:
            return false;
    }
}

/**
 * Thinking in noninternationalized USASCII (per the DNS spec), is this
 * character visible and not a space when printed ?
 * @param {number} ch
 * @private
 */
function printable(ch) {
    return ch > 0x20 && ch < 0x7F;
}

/**
 * Thinking in noninternationalized USASCII (per the DNS spec), conver this
 * character to lower case if it's upper case.
 * @param {number} ch
 * @return {number}
 * @private
 */
function mklower(ch) {
    if (ch >= 0x41 && ch <= 0x5A)
        return ch + 0x20;
    return ch;
}

/**
 * Search for the counted-label name in an array of compressed names (RFC1035
 * section 4.1.4).
 * @param {Buffer} src Buffer containing domain name to search for.
 * @param {number} domain Index of length-tagged domain name in `src` Buffer.
 * @param {Buffer} msg Contains domain names to search against.
 * @param {ReadonlyArray<number>} dnptrs Pointer to the first name on the list,
 * not the pointer to the start of the message.
 * @param {number} ndnptr Index of first pointer in dnptrs?
 * @param {number} lastdnptr Index of last pointer in dnptrs?
 * @return {number} offset into msg if found, or -1.
 * @private
 */
function dn_find(src, domain, msg, dnptrs, ndnptr, lastdnptr) {
    /** @type {number} */
    let dn;
    /** @type {number} */
    let cp;
    /** @type {number} */
    let sp;
    let cpp;
    let n;

    let next = false; // instead of goto
    for (cpp = ndnptr; cpp < lastdnptr; cpp++) {
        sp = dnptrs[cpp];
        // terminate search on:
        // root label
        // compression pointer
        // unusable offset
        while (msg[sp] !== 0 && (msg[sp] & NS_CMPRSFLGS) === 0 && sp < 0x4000) {
            dn = domain;
            cp = sp;
            while ((n = msg[cp++]) !== 0) {
                // check for indirection
                switch (n & NS_CMPRSFLGS) {
                    case 0: // normal case, n === len
                        n = labellen(msg, cp - 1); // XXX
                        if (n !== src[dn++]) {
                            next = true;
                            break;
                        }
                        for (null; n > 0; n--) {
                            if (mklower(src[dn++]) !== mklower(msg[cp++])) {
                                next = true;
                                break;
                            }
                        }
                        if (next) {
                            break;
                        }
                        // Is next root for both ?
                        if (src[dn] === 0 && msg[cp] === 0) {
                            return sp;
                        }
                        if (src[dn]) {
                            continue;
                        }
                        next = true;
                        break;
                    case NS_CMPRSFLGS: // indirection
                        cp = (n & 0x3f) << 8 | msg[cp];
                        break;

                    default: // illegal type
                        errno(EMSGSIZE);
                        return -1;
                }
                if (next) {
                    break;
                }
            }
            sp += msg[sp] + 1;
            if (next) {
                next = false;
            }
        }
    }
    errno(ENOENT);
    return -1;
}

/**
 * @todo This diverges heavily from libbind-6.0
 * @param {*} b
 * @param {Ptr} cpp
 * @param {*} d
 * @param {*} dn
 * @param {number} eom
 * @return {number}
 * @private
 */
function decode_bitstring(b, cpp, d, dn, eom) {
    let cp = cpp.get();
    let blen, plen;

    if ((blen = b[cp] & 0xff) === 0)
        blen = 256;
    plen = (blen + 3) / 4;
    plen += "\\[x/]".length + (blen > 99 ? 3 : blen > 9 ? 2 : 1);
    if (dn + plen >= eom)
        return -1;

    cp++;
    const i = d.write("\\[x", dn);
    if (i !== 3)
        return -1;
    dn += i;
    for (b = blen; b > 7; b -= 8, cp++) {
        if (dn + 2 >= eom)
            return -1;
    }
}

/**
 * @param {*} src
 * @param {Ptr} bp
 * @param {*} end
 * @param {Ptr} labelp
 * @param {*} dst
 * @param {Ptr} dstp
 * @param {*} eom
 * @return {number}
 * @private
 */
function encode_bitstring(src, bp, end, labelp, dst, dstp, eom) {
    let afterslash = 0;
    let cp = bp.get();
    let tp;
    let c;
    let beg_blen;
    let end_blen = null;
    let value = 0, count = 0, tbcount = 0, blen = 0;

    beg_blen = end_blen = null;

    // a bitstring must contain at least two bytes
    if (end - cp < 2)
        return EINVAL;

    // currently, only hex strings are supported
    if (src[cp++] !== 120) // "x"
        return EINVAL;
    if (!isxdigit(src[cp] & 0xff)) // reject "\[x/BLEN]"
        return EINVAL;

    let done = false;
    for (tp = dstp.get() + 1; cp < end && tp < eom; cp++) {
        switch (c = src[cp++]) {
            case 93: // "]"
                if (afterslash) {
                    if (beg_blen === null)
                        return EINVAL;
                    blen = strtol(src, beg_blen, 10);
                    // TODO
                    // if (*end_blen !== 93) // ']'
                    //     return EINVAL;
                }
                if (count)
                    dst[tp++] = value << 4 & 0xff;
                cp++; // skip "]"
                done = true;
                break;
            case 47: // "/"
                afterslash = 1;
                break;
            default:
                if (afterslash) {
                    if (!isxdigit(c & 0xff))
                        return EINVAL;
                    if (beg_blen === null) {

                        if (c === 48) { // '0'
                            // blen never begins with 0
                            return EINVAL;
                        }
                        beg_blen = cp;
                    }
                } else {
                    if (!isxdigit(c & 0xff))
                        return EINVAL;
                    value <<= 4;
                    value += digitvalue[c];
                    count += 4;
                    tbcount += 4;
                    if (tbcount > 256)
                        return EINVAL;
                    if (count === 8) {
                        dst[tp++] = value;
                        count = 0;
                    }
                }
                break;
        }
        if (done) {
            break;
        }
    }
    // done:
    if (cp >= end || tp >= eom)
        return EMSGSIZE;
    // bit length validation:
    // If a <length> is present, the number of digits in the <bit-data> MUST be
    // just sufficient to contain the number of bits specified by the <length>.
    // If there are insufficient bits in a final hexadecimal or octal digit,
    // they MUST be zero. RFC2673, Section 3.2
    if (blen && blen > 0) {
        if ((blen + 3 & ~3) !== tbcount)
            return EINVAL;
        const traillen = tbcount - blen; // between 0 and 3
        if ((value << 8 - traillen & 0xFF) !== 0)
            return EINVAL;
    } else
        blen = tbcount;
    if (blen === 256)
        blen = 0;

    // encode the type and the significant bit fields
    src[labelp.get()] = DNS_LABELTYPE_BITSTRING;
    dst[dstp.get()] = blen;

    bp.set(cp);
    dstp.set(tp);

    return 0;
}

function labellen(b, off) {
    let bitlen;
    const l = b[off];

    if ((l & NS_CMPRSFLGS) === NS_CMPRSFLGS) {
        return -1;
    }
    if ((l & NS_CMPRSFLGS) === NS_TYPE_ELT) {
        if (l === DNS_LABELTYPE_BITSTRING) {
            bitlen = b[off + 1];
            if (bitlen === 0) {
                bitlen = 256;
            }
            return 1 + (bitlen + 7) / 8;
        }
    }
    return l;
}

function isxdigit(ch) {
    return ch >= 48 && ch <= 57
        || ch >= 97 && ch <= 102
        || ch >= 65 && ch <= 70;
}

/**
 * Convert string to integer.
 * @param {Buffer} b
 * @param {number} off Byte offset to start decoding at.
 * @param {number} base
 */
function strtol(b, off, base) {
    // todo: port from C
    return Number.parseInt(b.toString("ascii", off), base);
}
