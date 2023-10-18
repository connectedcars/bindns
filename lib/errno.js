"use strict";
// Unix system error codes

let errno = 0;
/**
 * Gets/sets the "global" `errno`.
 * @param {number} v
 */
exports.errno = function (v) {
    if (v === undefined) return errno;
    errno = v;
};

/** No such file or directory */
exports.ENOENT = 2;
/** No such device */
exports.ENODEV = 19;
/** Is a directory */
exports.EISDIR = 21;
/** Invalid argument */
exports.EINVAL = 22;
/** File name too long */
exports.ENAMETOOLONG = 36;
/** Message too long */
exports.EMSGSIZE = 90;
