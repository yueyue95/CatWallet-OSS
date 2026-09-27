const fixedTime = process.env.CATWALLET_DEMO_NOW;

if (fixedTime) {
  const NativeDate = Date;
  const timestamp = new NativeDate(fixedTime).valueOf();

  class DemoDate extends NativeDate {
    constructor(...args) {
      if (args.length === 0) super(timestamp);
      else super(...args);
    }

    static now() {
      return timestamp;
    }

    static parse(value) {
      return NativeDate.parse(value);
    }

    static UTC(...args) {
      return NativeDate.UTC(...args);
    }
  }

  global.Date = DemoDate;
}
