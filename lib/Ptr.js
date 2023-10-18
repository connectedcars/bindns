"use strict";

module.exports = class Ptr {
    constructor(val) {
        this.p = val;
    }
    get() {
        return this.p;
    }
    set(val) {
        return this.p = val;
    }
};
