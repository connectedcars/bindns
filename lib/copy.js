"use strict";

// Node.js' buf.copy without C++ overhead since our copies are always small.
// src and target are restricted. No bounds checks.
module.exports = function copy(src, target, targetStart, sourceStart, sourceEnd) {
    while (sourceStart < sourceEnd) {
        target[targetStart++] = src[sourceStart++];
    }
};
