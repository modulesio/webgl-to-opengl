var tokenize = require('glsl-tokenizer')
var stringify = require('glsl-token-string')

module.exports.vertex = transpile.bind(null, true)
module.exports.fragment = transpile.bind(null, false)
module.exports.mapName = mapName
module.exports.unmapName = unmapName

var version = /^\s*\#version\s+([0-9]+(\s+[a-zA-Z]+)?)\s*/
var regex = /[^\r\n]$/
var newline = { data: '\n', type: 'whitespace' }

const coreGLSLExtensions = [
  'GL_OES_standard_derivatives',
  'GL_EXT_draw_buffers',
  'GL_EXT_shader_texture_lod',
];
/* const coreGLSL2Extensions = [
  'GL_ARB_separate_shader_objects',
]; */
const defaultNewVersion = '330';

var reservedWords = require('./lib/builtins')

function transpile(isVertex, source, newVersion = defaultNewVersion) {
  var tokens = tokenize(source)
  var oldVersion = versionify(tokens, newVersion)
  if (oldVersion !== newVersion) {
    for (i = tokens.length - 1; i >= 0; i--) {
      token = tokens[i]
      if (token.type === 'preprocessor') {
        var match = token.data.match(/\#extension\s+(.*)\:/)
        if (match && match[1] && coreGLSLExtensions.indexOf(match[1].trim()) >= 0) {
          var nextToken = tokens[i + 1]
          var count = (nextToken && nextToken.type === 'whitespace')
            ? 2 : 1
          tokens.splice(i, count)
        }
      }
    }

    var fragColorName = null
    var i, token
    for (i = 0; i < tokens.length; i++) {
      token = tokens[i]
      if (token.type === 'keyword') {
        if (token.data === 'attribute') token.data = 'in'
        else if (token.data === 'varying') token.data = isVertex ? 'out' : 'in'
      } else if ((token.type === 'preprocessor') && /^#define/.test(token.data)) {
        token.data = token.data.replace(/(texture)(?:2D|Cube)?(Lod)?(Grad)?(?:EXT)?/g, '$1$2$3');
      } else if ((token.type === 'builtin') && /^(texture)(?:2D|3D|Cube)?(Lod)?(?:EXT)?/.test(token.data)) {
        token.data = token.data.replace(/(texture)(?:2D|Cube)?(Lod)?(Grad)?(?:EXT)?/g, '$1$2$3');
      } else if (token.type === 'builtin' && !isVertex) {
        if (token.data === 'gl_FragColor') {
          if (!fragColorName) {
            fragColorName = mapName('fragColor')
            insertFragOutput(tokens, fragColorName, 'vec4')
          }
          token.data = fragColorName
        }
      } else if (token.type === 'ident' && reservedWords.indexOf(token.data) >= 0) {
        if (isVertex && isAttribute(tokens, i)) {
          throw new Error(`Unable to transpile GLSL 100 to ${newVersion} automatically: ` +
              `One of the vertex shader attributes is using a reserved ${newVersion} keyword "${token.data}"`)
        }
        token.data = mapName(token.data)
      }
    }
  }
  
  undefPredeclarations(tokens);

  return stringify(tokens)
}

function isAttribute (tokens, index) {
  for (var i = index - 1; i >= 0; i--) {
    var token = tokens[i]
    if (token.type === 'keyword') {
      if (token.data === 'attribute' || token.data === 'in') {
        return true
      }
    } else if (token.type === 'operator' ||
        token.type === 'float' ||
        token.type === 'ident' ||
        token.type === 'builtin' ||
        token.type === 'integer') {
      // If we hit another token, assume it's not an attribute
      return false
    }
  }
  return false
}

function insertFragOutput (tokens, name, dataType) {
  // inserts it before the first "in/out/attribute/varying"
  inject(tokens, [
    // "out vec4 fragColor;"
    { type: 'keyword', data: 'out' },
    { type: 'whitespace', data: ' ' },
    { type: 'keyword', data: dataType },
    { type: 'whitespace', data: ' ' },
    { type: 'ident', data: name },
    { type: 'operator', data: ';' }
  ])
}

/* function addGlsl2Extensions(tokens, i) {
  tokens.splice.apply(tokens, [i, 0, {
    data: '\n',
    type: 'whitespace'
  }].concat(coreGLSL2Extensions.flatMap(ext => [
    {
      data: `#extension ${ext} : enable`,
      type: 'preprocessor'
    },
    {
      data: '\n',
      type: 'whitespace'
    },
  ])).concat([{
    data: '\n',
    type: 'whitespace'
  }]))
} */

function undefPredeclarations(tokens) {
  for (;;) {
    const startIndex = tokens.findIndex(t => t.type === 'preprocessor' && /^#ifdef\s+(?:GL_ARB_gpu_shader5|GL_NV_gpu_shader5)/.test(t.data));
    if (startIndex !== -1) {
      const endIndex = findNextEndif(tokens, startIndex + 1);
      if (endIndex !== -1) {
        tokens.splice(startIndex, endIndex - startIndex + 1);
      } else {
        break;
      }
    } else {
      break;
    }
  }
}

function versionify(tokens, newVersion) {
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i]
    if (token.type === 'preprocessor') {
      var match = version.exec(token.data)
      if (match) {
        var number = match[1].replace(/\s\s+/g, ' ')
        if (number === '300 es') {
          number = newVersion;
          tokens.splice(i, 1, {
            data: `#version ${number}`,
            type: 'preprocessor'
          })
        }
        if (number === newVersion) {
          // addGlsl2Extensions(tokens, i + 1)
          return number
        } else if (number === '100') {
          tokens.splice(i, 1, {
            data: `#version ${newVersion}`,
            type: 'preprocessor'
          })
          // addGlsl2Extensions(tokens, i + 1);
          return number
        } else {
          throw new Error('unknown #version type: ' + number)
        }
      }
    }
  }

  // no version found, insert into start
  tokens.splice(0, 0, {
    data: `#version ${newVersion}`,
    type: 'preprocessor'
  }, {
    data: '\n',
    type: 'whitespace'
  })
  // addGlsl2Extensions(tokens, 1)

  return null
}

function mapName(name) {
  if (name === 'fragColor' || reservedWords.indexOf(name) >= 0) {
    name = 'unique_' + name;
  }
  return name;
}

function unmapName(name) {
  const match = name.match(/^unique_(.+)$/);
  if (match) {
    name = match[1];
  }
  return name;
}

function inject(tokens, newTokens) {
  if (!Array.isArray(newTokens))
    newTokens = [ newTokens ]
  var start = getStartIndex(tokens)
  var last = start > 0 ? tokens[start-1] : null
  if (last && regex.test(last.data)) {
    tokens.splice(start++, 0, newline)
  }
  tokens.splice.apply(tokens, [ start, 0 ].concat(newTokens))

  var end = start + newTokens.length
  if (tokens[end] && /[^\r\n]$/.test(tokens[end].data)) {
    tokens.splice(end, 0, newline)
  }
  return tokens
}

function findNextEndif(tokens, i) {
  for (; i < tokens.length; i++) {
    const token = tokens[i];
    if (/^#ifn?def/.test(token.data)) {
      const endif = findNextEndif(tokens, i + 1);
      if (endif === -1) {
        throw new Error('#if with no #endif');
      }
      i = endif;
    } else if (token.type === 'preprocessor' && /^#endif/.test(token.data)) {
      return i;
    }
  }
  return -1;
}

function getStartIndex(tokens) {
  // determine starting index for attributes
  var start = -1
  for (var i = 0; i < tokens.length; i++) {
    var token = tokens[i]
    if (token.type === 'preprocessor') {
      if (/^#(extension|version)/.test(token.data)) {
        start = i;
      } else if (/^#ifn?def/.test(token.data)) {
        const endif = findNextEndif(tokens, i + 1);
        if (endif === -1) {
          throw new Error('#if with no #endif');
        }
        start = i = endif;
      }
    } else if (token.type === 'keyword' && token.data === 'precision') {
      var semi = findNextSemicolon(tokens, i);
      if (semi === -1) {
        throw new Error('precision statement not followed by any semicolons!');
      }
      start = i = semi;
    } else if (token.type === 'whitespace') {
      continue;
    } else {
      break;
    }
  }

  if (start < tokens.length) {
    start++;
  }

  return start
}

function findNextSemicolon(tokens, start) {
  for (var i = start; i < tokens.length; i++) {
    if (tokens[i].type === 'operator' && tokens[i].data === ';') {
      return i
    }
  }
  return -1
}
