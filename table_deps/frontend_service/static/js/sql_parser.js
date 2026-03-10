// ── SHARED SQL PARSING CONSTANTS ─────────────────────────────
const SQL_KEYWORDS = new Set([
  'select','from','where','join','inner','left','right','full','outer','cross',
  'on','as','and','or','not','in','exists','between','like','is','null','true',
  'false','case','when','then','else','end','group','by','order','having',
  'limit','offset','union','all','distinct','with','recursive','lateral',
  'insert','update','delete','into','values','set','create','materialized',
  'view','replace','table','temp','temporary','if','using','over','partition',
  'filter','rows','range','preceding','following','current','row',
]);

// Factory — returns a fresh regex each call to reset lastIndex
const FROM_JOIN_RE = () =>
  /\b(FROM|((?:LEFT|RIGHT|INNER|FULL|CROSS)\s+(?:OUTER\s+)?)?JOIN)\s+([`"\[]?[\w]+[`"\]]?(?:\.[`"\[]?[\w]+[`"\]]?)*)/gi;
