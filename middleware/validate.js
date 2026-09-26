function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed.',
        code: 'VALIDATION_ERROR',
        fields: result.error.flatten().fieldErrors,
        requestId: req.requestId,
      });
    }
    req[source] = result.data;
    next();
  };
}

module.exports = { validate };
