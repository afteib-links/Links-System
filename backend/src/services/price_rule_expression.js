const FUNCTIONS = Object.freeze({
  IF: (condition, yes, no) => (condition ? yes : no),
  AND: (...values) => values.every(Boolean),
  OR: (...values) => values.some(Boolean),
  NOT: (value) => !value,
  ABS: (value) => Math.abs(Number(value || 0)),
  MIN: (...values) => Math.min(...values.map(Number)),
  MAX: (...values) => Math.max(...values.map(Number)),
  ROUND: (value, digits = 0) => roundWith(Number(value), Number(digits), Math.round),
  ROUNDDOWN: (value, digits = 0) => roundWith(Number(value), Number(digits), Math.trunc),
  ROUNDUP: (value, digits = 0) => {
    const factor = 10 ** Number(digits || 0);
    const scaled = Number(value) * factor;
    return (scaled < 0 ? Math.floor(scaled) : Math.ceil(scaled)) / factor;
  },
});

const CURRENT_VARIABLES = new Set([
  'work_date', 'weekday', 'is_holiday', 'is_project_holiday', 'is_training', 'is_absent',
  'start_time', 'end_time', 'break_minutes', 'duration_minutes', 'work_minutes',
  'normal_minutes', 'overtime_minutes', 'regular_overtime_minutes', 'night_minutes',
  'night_overtime_minutes', 'shortage_minutes', 'total_distance', 'billing', 'payment',
]);

function roundWith(value, digits, method) {
  const factor = 10 ** Number(digits || 0);
  return method(value * factor) / factor;
}

function tokenize(source) {
  const input = String(source || '').trim().replace(/^=/, '');
  if (input.length > 500) throw new Error('式は500文字以内で入力してください');
  const tokens = [];
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (/\s/.test(ch)) { i += 1; continue; }
    const two = input.slice(i, i + 2);
    if (['<=', '>=', '<>', '!=', '=='].includes(two)) {
      tokens.push({ type: 'op', value: two }); i += 2; continue;
    }
    if ('+-*/%^(),=<>'.includes(ch)) {
      tokens.push({ type: 'op', value: ch }); i += 1; continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let value = '';
      i += 1;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) { value += input[i + 1]; i += 2; }
        else { value += input[i]; i += 1; }
      }
      if (input[i] !== quote) throw new Error('文字列が閉じられていません');
      i += 1;
      tokens.push({ type: 'literal', value });
      continue;
    }
    const number = input.slice(i).match(/^\d+(?:\.\d+)?/);
    if (number) { tokens.push({ type: 'literal', value: Number(number[0]) }); i += number[0].length; continue; }
    const identifier = input.slice(i).match(/^[\p{L}_][\p{L}\p{N}_.]*/u);
    if (identifier) { tokens.push({ type: 'identifier', value: identifier[0] }); i += identifier[0].length; continue; }
    throw new Error(`使用できない文字です: ${ch}`);
  }
  tokens.push({ type: 'eof', value: '' });
  return tokens;
}

function parse(source) {
  const tokens = tokenize(source);
  let pos = 0;
  const refs = new Set();
  const peek = () => tokens[pos];
  const take = (value = null) => {
    const token = tokens[pos];
    if (value != null && token.value !== value) throw new Error(`「${value}」が必要です`);
    pos += 1;
    return token;
  };
  function primary() {
    const token = peek();
    if (token.value === '(') { take('('); const value = comparison(); take(')'); return value; }
    if (token.type === 'literal') { take(); return { type: 'literal', value: token.value }; }
    if (token.type !== 'identifier') throw new Error('値または項目名が必要です');
    take();
    const upper = token.value.toUpperCase();
    if (upper === 'TRUE' || upper === 'FALSE') return { type: 'literal', value: upper === 'TRUE' };
    if (peek().value === '(') {
      if (!FUNCTIONS[upper]) throw new Error(`使用できない関数です: ${token.value}`);
      take('(');
      const args = [];
      if (peek().value !== ')') {
        do { args.push(comparison()); if (peek().value !== ',') break; take(','); } while (true);
      }
      take(')');
      return { type: 'call', name: upper, args };
    }
    refs.add(token.value);
    return { type: 'variable', name: token.value };
  }
  function unary() {
    if (peek().value === '+' || peek().value === '-') return { type: 'unary', op: take().value, value: unary() };
    return primary();
  }
  function power() {
    let left = unary();
    while (peek().value === '^') left = { type: 'binary', op: take().value, left, right: unary() };
    return left;
  }
  function product() {
    let left = power();
    while (['*', '/', '%'].includes(peek().value)) left = { type: 'binary', op: take().value, left, right: power() };
    return left;
  }
  function sum() {
    let left = product();
    while (['+', '-'].includes(peek().value)) left = { type: 'binary', op: take().value, left, right: product() };
    return left;
  }
  function comparison() {
    let left = sum();
    while (['=', '==', '<>', '!=', '<', '>', '<=', '>='].includes(peek().value)) {
      left = { type: 'binary', op: take().value, left, right: sum() };
    }
    return left;
  }
  const ast = comparison();
  if (peek().type !== 'eof') throw new Error(`式の末尾を解釈できません: ${peek().value}`);
  return { ast, references: [...refs] };
}

function valueAt(context, name) {
  return name.split('.').reduce((value, key) => (value == null ? undefined : value[key]), context);
}

function evaluateAst(node, context) {
  if (node.type === 'literal') return node.value;
  if (node.type === 'variable') {
    const value = valueAt(context, node.name);
    if (value === undefined) throw new Error(`未定義の項目です: ${node.name}`);
    return value;
  }
  if (node.type === 'unary') {
    const value = Number(evaluateAst(node.value, context));
    return node.op === '-' ? -value : value;
  }
  if (node.type === 'call') {
    if (node.name === 'IF') {
      const condition = evaluateAst(node.args[0], context);
      return evaluateAst(condition ? node.args[1] : node.args[2], context);
    }
    if (node.name === 'AND') {
      for (const arg of node.args) if (!evaluateAst(arg, context)) return false;
      return true;
    }
    if (node.name === 'OR') {
      for (const arg of node.args) if (evaluateAst(arg, context)) return true;
      return false;
    }
    return FUNCTIONS[node.name](...node.args.map((arg) => evaluateAst(arg, context)));
  }
  const left = evaluateAst(node.left, context);
  const right = evaluateAst(node.right, context);
  switch (node.op) {
    case '+': return Number(left) + Number(right);
    case '-': return Number(left) - Number(right);
    case '*': return Number(left) * Number(right);
    case '/': if (Number(right) === 0) throw new Error('0で除算できません'); return Number(left) / Number(right);
    case '%': if (Number(right) === 0) throw new Error('0で除算できません'); return Number(left) % Number(right);
    case '^': return Number(left) ** Number(right);
    case '=': case '==': return left === right || Number(left) === Number(right);
    case '<>': case '!=': return !(left === right || Number(left) === Number(right));
    case '<': return left < right;
    case '>': return left > right;
    case '<=': return left <= right;
    case '>=': return left >= right;
    default: throw new Error(`未対応の演算子です: ${node.op}`);
  }
}

function inspectExpression(source) {
  if (!String(source || '').trim()) return { ok: true, references: [], undefined_variables: [] };
  try {
    const parsed = parse(source);
    const undefinedVariables = parsed.references.filter((name) => !CURRENT_VARIABLES.has(name));
    return { ok: true, references: parsed.references, undefined_variables: undefinedVariables };
  } catch (error) {
    return { ok: false, message: error.message, references: [], undefined_variables: [] };
  }
}

function evaluateExpression(source, context = {}) {
  if (!String(source || '').trim()) return null;
  const parsed = parse(source);
  return evaluateAst(parsed.ast, context);
}

module.exports = { CURRENT_VARIABLES, inspectExpression, evaluateExpression, parse };
