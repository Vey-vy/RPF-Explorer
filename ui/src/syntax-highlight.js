import {escapeHtml} from './utils.js';

const syntaxExtensions = {
  markup: new Set(['xml', 'html', 'htm', 'xhtml']),
  json: new Set(['json']),
  ini: new Set(['ini', 'cfg', 'conf']),
  csv: new Set(['csv']),
  lua: new Set(['lua']),
};
const markupEntityPattern = /&(?:#(?:x[\da-f]+|\d+)|[\w.-]+);/iy;
const jsonNumberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const jsonKeywordPattern = /(?:true|false|null)\b/y;
const iniNumberPattern = /-?(?:0x[\da-f]+|\d+(?:\.\d+)?)/iy;
const iniKeywordPattern = /(?:true|false|yes|no|on|off|null)\b/iy;
const csvNumberPattern = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const luaLongCommentPattern = /--\[(=*)\[/y;
const luaLongStringPattern = /\[(=*)\[/y;
const luaNumberPattern = /(?:0x[\da-f]+|\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/iy;
const luaIdentifierPattern = /[A-Za-z_]\w*/y;

function matchAt(pattern, text, index) {
  pattern.lastIndex = index;
  return pattern.exec(text);
}

export function highlightText(source, name = '') {
  const text = String(source ?? '');
  if (text.length > 500_000) return escapeHtml(text);

  const extension = name.split('.').pop().toLowerCase();
  if (syntaxExtensions.markup.has(extension))
    return highlightMarkup(text);
  if (syntaxExtensions.json.has(extension))
    return highlightJson(text);
  if (syntaxExtensions.ini.has(extension))
    return highlightIni(text);
  if (syntaxExtensions.csv.has(extension))
    return highlightCsv(text);
  if (syntaxExtensions.lua.has(extension))
    return highlightLua(text);
  return escapeHtml(text);
}

function syntaxToken(type, text) {
  return `<span class="syntax-${type}">${escapeHtml(text)}</span>`;
}

function highlightMarkup(text) {
  let output = '';
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('<!--', index)) {
      const end = text.indexOf('-->', index + 4);
      const next = end < 0 ? text.length : end + 3;
      output += syntaxToken('comment', text.slice(index, next));
      index = next;
      continue;
    }
    if (text.startsWith('<![CDATA[', index)) {
      const end = text.indexOf(']]>', index + 9);
      const next = end < 0 ? text.length : end + 3;
      output += syntaxToken('string', text.slice(index, next));
      index = next;
      continue;
    }
    if (text[index] === '<' && /[!?/A-Za-z]/.test(text[index + 1] || '')) {
      output += syntaxToken('punctuation', '<');
      index++;
      if (text[index] === '/' || text[index] === '!' || text[index] === '?') {
        output += syntaxToken('punctuation', text[index]);
        index++;
      }
      const tagStart = index;
      while (index < text.length && /[\w:.-]/.test(text[index])) index++;
      if (index > tagStart)
        output += syntaxToken('tag', text.slice(tagStart, index));
      while (index < text.length) {
        if (/\s/.test(text[index])) {
          output += escapeHtml(text[index++]);
          continue;
        }
        if (text[index] === '"' || text[index] === '\'') {
          const quote = text[index];
          const start = index++;
          while (index < text.length && text[index] !== quote) index++;
          if (index < text.length) index++;
          output += syntaxToken('string', text.slice(start, index));
          continue;
        }
        if (text[index] === '>') {
          output += syntaxToken('punctuation', text[index++]);
          break;
        }
        if (text[index] === '=') {
          output += syntaxToken('punctuation', text[index++]);
          continue;
        }
        if (/[A-Za-z_:]/.test(text[index])) {
          const start = index++;
          while (index < text.length && /[\w:.-]/.test(text[index])) index++;
          output += syntaxToken('attribute', text.slice(start, index));
          continue;
        }
        output += escapeHtml(text[index++]);
      }
      continue;
    }
    if (text[index] === '&') {
      const entity = matchAt(markupEntityPattern, text, index);
      if (entity) {
        output += syntaxToken('number', entity[0]);
        index += entity[0].length;
        continue;
      }
    }
    output += escapeHtml(text[index++]);
  }
  return output;
}

function highlightJson(text) {
  let output = '';
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === '"' || char === '\'') {
      const quote = char;
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += Math.min(2, text.length - index);
          continue;
        }
        if (text[index++] === quote) break;
      }
      let lookahead = index;
      while (/\s/.test(text[lookahead] || '') && lookahead < text.length)
        lookahead++;
      output += syntaxToken(
          quote === '"' && text[lookahead] === ':' ? 'key' : 'string',
          text.slice(start, index));
      continue;
    }
    const number = matchAt(jsonNumberPattern, text, index);
    if (number) {
      output += syntaxToken('number', number[0]);
      index += number[0].length;
      continue;
    }
    const word = matchAt(jsonKeywordPattern, text, index);
    if (word) {
      output += syntaxToken('keyword', word[0]);
      index += word[0].length;
      continue;
    }
    if ('{}[],:'.includes(char)) {
      output += syntaxToken('punctuation', char);
      index++;
      continue;
    }
    output += escapeHtml(char);
    index++;
  }
  return output;
}

function highlightIni(text) {
  return text.split(/(\r\n|\n|\r)/).map((line, index, parts) => {
    if (index % 2 === 1) return escapeHtml(line);
    const trimmed = line.trimStart();
    if (/^[#;]/.test(trimmed)) return syntaxToken('comment', line);
    const section = line.match(/^(\s*)(\[[^\]\r\n]*\])(\s*)$/);
    if (section)
      return escapeHtml(section[1]) + syntaxToken('tag', section[2]) +
          escapeHtml(section[3]);

    const keyMatch = line.match(/^(\s*)([^=:#\s][^=:]*?)(\s*)([=:])/);
    if (!keyMatch) return highlightIniValue(line);
    const keyEnd = keyMatch[0].length;
    return escapeHtml(keyMatch[1]) + syntaxToken('key', keyMatch[2]) +
        escapeHtml(keyMatch[3]) + syntaxToken('punctuation', keyMatch[4]) +
        highlightIniValue(line.slice(keyEnd));
  }).join('');
}

function highlightIniValue(value) {
  let output = '';
  let index = 0;
  while (index < value.length) {
    if ((value[index] === '#' || value[index] === ';') &&
        (index === 0 || /\s/.test(value[index - 1]))) {
      output += syntaxToken('comment', value.slice(index));
      break;
    }
    if (value[index] === '"' || value[index] === '\'') {
      const quote = value[index];
      const start = index++;
      while (index < value.length && value[index] !== quote) index++;
      if (index < value.length) index++;
      output += syntaxToken('string', value.slice(start, index));
      continue;
    }
    const number = matchAt(iniNumberPattern, value, index);
    if (number) {
      output += syntaxToken('number', number[0]);
      index += number[0].length;
      continue;
    }
    const word = matchAt(iniKeywordPattern, value, index);
    if (word) {
      output += syntaxToken('keyword', word[0]);
      index += word[0].length;
      continue;
    }
    output += escapeHtml(value[index++]);
  }
  return output;
}

function highlightCsv(text) {
  let output = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '"') {
      const start = index++;
      while (index < text.length) {
        if (text[index] === '"' && text[index + 1] === '"') {
          index += 2;
          continue;
        }
        if (text[index++] === '"') break;
      }
      output += syntaxToken('string', text.slice(start, index));
      continue;
    }
    if (text[index] === ',') {
      output += syntaxToken('punctuation', text[index++]);
      continue;
    }
    const number = matchAt(csvNumberPattern, text, index);
    if (number) {
      output += syntaxToken('number', number[0]);
      index += number[0].length;
      continue;
    }
    output += escapeHtml(text[index++]);
  }
  return output;
}

function highlightLua(text) {
  const keywords = new Set([
    'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
    'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return',
    'then', 'true', 'until', 'while'
  ]);
  let output = '';
  let index = 0;
  while (index < text.length) {
    if (text.startsWith('--', index)) {
      const longComment = matchAt(luaLongCommentPattern, text, index);
      if (longComment) {
        const close = `]${longComment[1]}]`;
        const end = text.indexOf(close, index + longComment[0].length);
        const next = end < 0 ? text.length : end + close.length;
        output += syntaxToken('comment', text.slice(index, next));
        index = next;
      } else {
        const end = text.indexOf('\n', index);
        const next = end < 0 ? text.length : end;
        output += syntaxToken('comment', text.slice(index, next));
        index = next;
      }
      continue;
    }
    const longString = matchAt(luaLongStringPattern, text, index);
    if (longString) {
      const close = `]${longString[1]}]`;
      const end = text.indexOf(close, index + longString[0].length);
      const next = end < 0 ? text.length : end + close.length;
      output += syntaxToken('string', text.slice(index, next));
      index = next;
      continue;
    }
    if (text[index] === '"' || text[index] === '\'') {
      const quote = text[index];
      const start = index++;
      while (index < text.length) {
        if (text[index] === '\\') {
          index += Math.min(2, text.length - index);
          continue;
        }
        if (text[index++] === quote) break;
      }
      output += syntaxToken('string', text.slice(start, index));
      continue;
    }
    const number = matchAt(luaNumberPattern, text, index);
    if (number) {
      output += syntaxToken('number', number[0]);
      index += number[0].length;
      continue;
    }
    const identifier = matchAt(luaIdentifierPattern, text, index);
    if (identifier) {
      output += syntaxToken(
          keywords.has(identifier[0]) ? 'keyword' : 'identifier',
          identifier[0]);
      index += identifier[0].length;
      continue;
    }
    if ('+-*/%^#=<>~(){}[];:,.'.includes(text[index])) {
      output += syntaxToken('punctuation', text[index++]);
      continue;
    }
    output += escapeHtml(text[index++]);
  }
  return output;
}
