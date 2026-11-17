'use strict';
// Test helper: pulls one function or statement out of an app source file so a
// test can run it in isolation. It matches brackets instead of relying on line
// breaks, so it keeps working however the source is formatted.

// Index just past the bracket that closes the one at `open`, skipping strings,
// template literals, comments and regular expressions.
function closeOf(source, open) {
  const pairs = { '(': ')', '[': ']', '{': '}' };
  const stack = [];
  const templateDepth = []; // stack depths at which a `${` was opened inside a template
  let last = ''; // last significant character, used to tell a regex from a division
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      i = source.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i = source.indexOf('*/', i + 2) + 1;
      continue;
    }
    if (c === "'" || c === '"') {
      for (i++; i < source.length && source[i] !== c; i++) if (source[i] === '\\') i++;
      last = c;
      continue;
    }
    if (c === '`' || (c === '}' && templateDepth.length && templateDepth[templateDepth.length - 1] === stack.length)) {
      if (c === '}') templateDepth.pop();
      for (i++; i < source.length; i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === '`') break;
        else if (source[i] === '$' && source[i + 1] === '{') {
          templateDepth.push(stack.length);
          i++;
          break;
        }
      }
      last = '`';
      continue;
    }
    if (c === '/' && (last === '' || '(,=:[!&|?{};+-*%<>~^'.includes(last))) {
      let inClass = false;
      for (i++; i < source.length; i++) {
        if (source[i] === '\\') i++;
        else if (source[i] === '[') inClass = true;
        else if (source[i] === ']') inClass = false;
        else if (source[i] === '/' && !inClass) break;
      }
      last = 'r';
      continue;
    }
    if (pairs[c]) stack.push(pairs[c]);
    else if (c === ')' || c === ']' || c === '}') {
      if (stack.pop() !== c) throw Error(`Unbalanced "${c}" at ${i}`);
      if (!stack.length) return i + 1;
    }
    if (!/\s/.test(c)) last = c;
  }
  throw Error('No closing bracket found');
}

// Full source of `function name(...) {...}` (or `async function`).
function functionSource(source, name) {
  const match = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(source);
  if (!match) throw Error(`Function ${name} not found`);
  const paramsEnd = closeOf(source, match.index + match[0].length - 1);
  const body = source.indexOf('{', paramsEnd);
  return source.slice(match.index, closeOf(source, body));
}

// A statement starting with `start` (a string or RegExp), up to its closing `;`.
function statementSource(source, start) {
  const index = typeof start === 'string' ? source.indexOf(start) : source.search(start);
  if (index < 0) throw Error(`Statement ${start} not found`);
  for (let i = index; i < source.length; i++) {
    const c = source[i];
    if ('([{'.includes(c)) i = closeOf(source, i) - 1;
    else if (c === "'" || c === '"' || c === '`') i = closeOf(`(${source.slice(i)})`, 0) + i - 3;
    else if (c === ';' || c === '\n') {
      if (c === ';') return source.slice(index, i + 1);
      // A line break ends the statement unless the next line continues it.
      const rest = source.slice(i + 1).trimStart();
      if (!/^[.?:+\-*/&|=,]/.test(rest)) return source.slice(index, i);
    }
  }
  return source.slice(index);
}

module.exports = { functionSource, statementSource, closeOf };
