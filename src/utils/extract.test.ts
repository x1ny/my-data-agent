import { describe, expect, test } from "bun:test";
import { JsonDatasetExtractor } from "./extract";
import path from "node:path";

const testData = await Bun.file(path.join(__dirname, "../../input/task_89/context/json/races.json")).json();
const extractor = new JsonDatasetExtractor({
  flatten: true,
  ignoreImpurity: true,
  promoteMapKeys: true,
});
const  res  = extractor.extract(testData);
console.log(res);

describe("JsonDatasetExtractor - Full Scenario Coverage", () => {
  const extractor = new JsonDatasetExtractor({
    flatten: true,
    ignoreImpurity: true,
    promoteMapKeys: true,
  });

  test("Scenario 1: Standard single table", () => {
    const input = {
      records: [
        { id: 1, name: "A" },
        { id: 2, name: "B" },
      ],
    };
    const res = extractor.extract(input);
    expect(res).toHaveLength(1);
    expect(res[0]!.name).toBe("records");
    expect(res[0]!.rows).toEqual([
      { id: 1, name: "A" },
      { id: 2, name: "B" },
    ]);
  });

  test("Scenario 2: Root array", () => {
    const input = [{ uid: "101" }, { uid: "102" }];
    const res = extractor.extract(input);
    expect(res[0]!.name).toBe("root_data");
    expect(res[0]!.rows).toEqual([{ uid: "101" }, { uid: "102" }]);
  });

  test("Scenario 3: Deeply nested object", () => {
    const input = { a: { b: { list: [{ val: 1 }, { val: 2 }] } } };
    const res = extractor.extract(input);
    expect(res[0]!.name).toBe("a_b_list"); // 自动拼接路径
  });

  test("Scenario 4: Multi-table parallel", () => {
    const input = { users: [{ id: 1 }], products: [{ pid: "p1" }] };
    const res = extractor.extract(input);
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.name)).toEqual(["users", "products"]);
  });

  test("Scenario 5: Object Map structure", () => {
    const input = {
      id_1: { name: "A" },
      id_2: { name: "B" },
    };
    const res = extractor.extract(input);
    expect(res[0]!.origin).toBe("map");
    // __key 作为补充字段打平放入了每一行
    expect(res[0]!.rows).toEqual([
      { __key: "id_1", name: "A" },
      { __key: "id_2", name: "B" },
    ]);
  });

  test("Scenario 6: Matrix (2D Array)", () => {
    const input = [
      ["header1", "header2"],
      [10, 20],
      [30, 40],
    ];
    const res = extractor.extract(input);
    expect(res[0]!.origin).toBe("matrix");
    // 自动将首行转为 Key
    expect(res[0]!.rows).toEqual([
      { header1: 10, header2: 20 },
      { header1: 30, header2: 40 },
    ]);
  });

  test("Scenario 7: Container arrays (Nested arrays)", () => {
    const input = {
      data: [[{ id: 1 }, { id: 2 }], [{ id: 3 }]],
    };
    const res = extractor.extract(input);
    // 外层容器被成功剥离
    expect(res[0]!.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
  });

  test("Scenario 8: Impurity array filtering", () => {
    const input = { list: [{ id: 1 }, "trash_string", null, 999, { id: 2 }] };
    const res = extractor.extract(input);
    // 非对象的杂质被抛弃
    expect(res[0]!.rows).toEqual([{ id: 1 }, { id: 2 }]);
  });

  test("Scenario 10: Deep object flattening", () => {
    const input = {
      data: [{ id: 1, user: { name: "Tom", loc: { city: "NY" } } }],
    };
    const res = extractor.extract(input);
    // user 和 loc 嵌套被展平，以 _ 连接
    expect(res[0]!.rows).toEqual([
      { id: 1, user_name: "Tom", user_loc_city: "NY" },
    ]);
  });
});
