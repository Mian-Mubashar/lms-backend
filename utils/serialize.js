const toId = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  return value.toString();
};

const asPlain = (doc) => {
  if (!doc) return null;
  if (typeof doc.toJSON === 'function') return doc.toJSON();
  return doc;
};

module.exports = {
  toId,
  asPlain
};

