// Decoded audio is scoped to this document. No private audio is persisted.
export class AudioCache {
  constructor(maxBytes=32*1024*1024,maxEntries=32){this.items=new Map();this.bytes=0;this.maxBytes=maxBytes;this.maxEntries=maxEntries;}
  get(key){const item=this.items.get(key);if(!item)return null;this.items.delete(key);this.items.set(key,item);return item.buffer;}
  put(key,buffer){
    const bytes=buffer.length*buffer.numberOfChannels*4;
    if(!Number.isFinite(bytes)||bytes>this.maxBytes)return;
    this.delete(key);this.items.set(key,{buffer,bytes});this.bytes+=bytes;
    while(this.bytes>this.maxBytes||this.items.size>this.maxEntries)this.delete(this.items.keys().next().value);
  }
  delete(key){const old=this.items.get(key);if(old){this.bytes-=old.bytes;this.items.delete(key);}}
  clear(){this.items.clear();this.bytes=0;}
}
