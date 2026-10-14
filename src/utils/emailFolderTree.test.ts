import { describe, expect, it } from "vitest";
import { buildEmailFolderTree, reorderedEmailFolders } from "./emailFolderTree";

describe("email folder hierarchy", () => {
  it("rebuilds missing parents and keeps equal folder names in separate accounts", () => {
    const tree = buildEmailFolderTree([
      { id: "a", name: "2026", path: "Anna/Archiv/2026", source: "outlook", sourceId: "store-one", count: 2 },
      { id: "b", name: "2026", path: "Anna/Archiv/2026", source: "outlook", sourceId: "store-two", count: 3 }
    ]);
    expect(tree).toHaveLength(2);
    expect(tree.map(node => node.total)).toEqual([2, 3]);
    expect(tree[0].folderId).toBeNull();
    expect(tree[0].children[0].children[0].folderId).toBe("a");
    expect(tree[0].key).not.toBe(tree[1].key);
  });
  it("shows existing archive rows without requiring an original client or new source metadata", () => {
    const tree = buildEmailFolderTree([
      { id: "nested", name: "Unterordner", path: "Local Folders/Inbox/Unterordner", source: "thunderbird", count: 4 },
      { id: "inbox", name: "Inbox", path: "Local Folders/Inbox", source: "thunderbird", count: 6 }
    ]);
    expect(tree[0].total).toBe(10);
    expect(tree[0].children[0].count).toBe(6);
    expect(tree[0].children[0].folderId).toBe("inbox");
  });
  it("keeps imported provider order, reads binary positions and lets user preferences take precedence", () => {
    const folders = [
      { id:"archive",name:"Archiv",path:"Account/Archiv",source:"outlook",sourceId:"one",count:1,importedOrder:1,sortKey:"20" },
      { id:"inbox",name:"Inbox",path:"Account/Inbox",source:"outlook",sourceId:"one",count:2,importedOrder:2,sortKey:"10" },
      { id:"work",name:"Work",path:"Account/Inbox/Work",source:"outlook",sourceId:"one",count:3,importedOrder:3,sortKey:"00" }
    ];
    const imported = buildEmailFolderTree(folders);
    expect(imported[0].children.map(node => node.folderId)).toEqual(["inbox","archive"]);
    const order = reorderedEmailFolders(imported,imported[0].children[1].key,imported[0].children[0].key)!;
    const custom = buildEmailFolderTree(folders,{ [order.scope]:order.keys });
    expect(custom[0].children.map(node => node.folderId)).toEqual(["archive","inbox"]);
    expect(custom[0].children[1].children[0].folderId).toBe("work");
    expect(custom[0].total).toBe(6);
    const changed = buildEmailFolderTree(folders.map(f => ({ ...f,sortKey:f.id === "archive" ? "00" : "99" })),{ [order.scope]:order.keys });
    expect(changed[0].children.map(node => node.folderId)).toEqual(["archive","inbox"]);
    const fallback = buildEmailFolderTree(folders.map(f => ({ ...f,sortKey:null,importedOrder:f.id === "inbox" ? 0 : f.importedOrder })));
    expect(fallback[0].children.map(node => node.folderId)).toEqual(["inbox","archive"]);
  });
  it("rejects moves to other accounts or levels and appends new folders to a saved order", () => {
    const folders = [
      { id:"a",name:"A",path:"Account/A",source:"outlook",sourceId:"one",count:1 },
      { id:"b",name:"B",path:"Account/B",source:"outlook",sourceId:"one",count:1 },
      { id:"c",name:"Child",path:"Account/A/Child",source:"outlook",sourceId:"one",count:1 },
      { id:"d",name:"D",path:"Other/D",source:"outlook",sourceId:"two",count:1 }
    ];
    const tree = buildEmailFolderTree(folders), [a,b] = tree[0].children;
    expect(reorderedEmailFolders(tree,a.key,a.children[0].key)).toBeNull();
    expect(reorderedEmailFolders(tree,a.key,tree[1].children[0].key)).toBeNull();
    const custom = buildEmailFolderTree([...folders,{ id:"new",name:"0 New",path:"Account/0 New",source:"outlook",sourceId:"one",count:1 }],{ [tree[0].key]:[b.key,a.key] });
    expect(custom[0].children.map(node => node.folderId)).toEqual(["b","a","new"]);
  });
});
