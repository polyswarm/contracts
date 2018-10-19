const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, json, simple } = format;

module.exports = (log_format) => {
  /* 
    This module returns a function which accepts a string
    and returns a winston logger.
    Args:
      log_format (str): 'json' to output logs in json format. Otherwise will use text format.

    Returns:
      function: A function which returns a winston logger

    Notes:
      Just keep in mind that this module exports a function that returns a winston logger, 
      not a winston logger directly.
  */
  let some_format;
  if (log_format == 'json') {
    some_format = combine(
                    label({ label: 'contracts' }),
                    timestamp(),
                    json()
                  );
  } else {
    some_format = simple();
  }
  return createLogger({
    format: some_format,
    // NOTE: There are many transport options, including saving to a file and streams.
    // more info: https://github.com/winstonjs/winston
    transports: [ new transports.Console() ]
  })
};