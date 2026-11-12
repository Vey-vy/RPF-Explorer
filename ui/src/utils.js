export const escapeHtml = (value = '') =>
    String(value).replace(/[&<>"']/g, (char) => ({
                                        '&': '&amp;',
                                        '<': '&lt;',
                                        '>': '&gt;',
                                        '"': '&quot;',
                                        '\'': '&#39;',
                                      }[char]));

export const humanSize = (size = 0) => {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / 1024 ** 2).toFixed(1)} MB`;
  return `${(size / 1024 ** 3).toFixed(1)} GB`;
};

export const fileType = (name = '') => {
  const ext = name.split('.').pop().toLowerCase();
  if (['png', 'jpg', 'jpeg', 'dds'].includes(ext)) return 'IMAGE';
  if ([
        'txt', 'xml', 'json', 'csv', 'ini', 'cfg', 'meta', 'dat', 'ide', 'ipl',
        'lua', 'fx'
      ].includes(ext))
    return 'TEXT';
  if (['ydr', 'ydd', 'yft', 'wdr', 'wft', 'wtd'].includes(ext))
    return 'RESOURCE';
  if (['wav', 'mp3', 'awc', 'ogg', 'bik'].includes(ext)) return 'AUDIO';
  return ext ? ext.toUpperCase() : 'FILE';
};
