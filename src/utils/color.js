function hashString(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function colorFromId(value) {
  const hash = hashString(String(value));
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 45%)`;
}

module.exports = {
  colorFromId,
};
