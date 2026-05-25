const byteToSize = b => (s => (i => Math.round(b / Math.pow(1024, i)) + " " + s[i])(Math.min(Math.floor(Math.log(b) / Math.log(1024)), s.length - 1)))(["Bytes", "KB", "MB", "GB", "TB"]);


export {byteToSize}