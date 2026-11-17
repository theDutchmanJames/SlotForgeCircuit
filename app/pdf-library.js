// Loads the PDF library and its fonts (about 2 MB) the first time a PDF is made,
// instead of on every start. PDF reports and panel assembly sheets call load() first.
(function (root) {
  'use strict';
  let loading = null;
  function script(src) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = src;
      tag.onload = resolve;
      tag.onerror = () => reject(Error('The PDF library could not be loaded. Reload Circuit and try again.'));
      document.head.append(tag);
    });
  }
  function load() {
    if (root.jspdf?.jsPDF && root.SlotForgePdfFonts) return Promise.resolve();
    loading ??= script('vendor/jspdf.umd.min.js')
      .then(() => script('vendor/pdf-fonts.js'))
      .catch(e => {
        loading = null;
        throw e;
      });
    return loading;
  }
  // Stand-ins handed to the PDF modules when they load; they reach the real library once loaded.
  const jsPDF = function (options) {
    if (!root.jspdf?.jsPDF) throw Error('The PDF library is not loaded yet.');
    return new root.jspdf.jsPDF(options);
  };
  const fonts = {
    get regular() {
      return root.SlotForgePdfFonts?.regular;
    },
    get bold() {
      return root.SlotForgePdfFonts?.bold;
    },
  };
  root.PdfLibrary = { load, jsPDF, fonts };
})(window);
