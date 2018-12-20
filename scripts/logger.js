const { createLogger, format, transports } = require('winston');
const { combine, timestamp, label, json, simple } = format;

module.exports = (log_type) => {
  /*
    This module returns a function which accepts a string
    and returns a winston logger.
    Args:
      log_type (str): 'json' to output logs in json format. Otherwise will use text format.

    Returns:
      function: A function which returns a winston logger

    Notes:
      Just keep in mind that this module exports a function that returns a winston logger,
      not a winston logger directly.
  */
  let some_format;

  // All of the canonicalization will happen here.
  const log_type_checked = (log_type == 'json' ? 'json' : 'text');

  if (log_type_checked == 'json') {
    some_format = combine(
                    label({ label: 'contracts' }),
                    timestamp(),
                    json()
                  );
  } else {
    some_format = simple();
  }
  let some_logger = createLogger({
    format: some_format,
    // NOTE: There are many transport options, including saving to a file and streams.
    // more info: https://github.com/winstonjs/winston
    transports: [ new transports.Console() ]
  })

  // Storing the format for consumption outside. ps_log_type to avoid any naming conflicts
  some_logger.ps_log_type = log_type_checked;
  return some_logger;
};