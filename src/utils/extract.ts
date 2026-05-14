// ---------------------------------------------------------
// 接口定义
// ---------------------------------------------------------
export interface ExtractionOptions {
    flatten: boolean; // 是否扁平化深层嵌套对象 (如 info.age -> info_age)
    ignoreImpurity: boolean; // 是否过滤数组中的非对象杂质 (如 null, string)
    promoteMapKeys: boolean; // 是否将 Map 结构的 Key 转化为 __key 字段
  }
  
  export interface Dataset {
    name: string;
    rows: any[];
    origin: "array" | "map" | "matrix";
  }
  
  interface RawCandidate {
    suggestedName: string;
    data: any;
    type: "ARRAY" | "MAP" | "MATRIX";
  }
  
  // ---------------------------------------------------------
  // 核心提取器
  // ---------------------------------------------------------
  
  export class JsonDatasetExtractor {
    constructor(
      private options: ExtractionOptions = {
        flatten: true,
        ignoreImpurity: true,
        promoteMapKeys: true,
      },
    ) {}
  
    /**
     * 主入口：传入任意不确定的 JSON 数据，返回结构化的 Dataset 数组
     */
    public extract(rawData: any): Dataset[] {
      const candidates = this.findPotentialArrays(rawData);
      return candidates.map((c) => this.normalize(c));
    }
  
    /**
     * 递归扫描 JSON 树，使用启发式算法定位候选数据集
     */
    private findPotentialArrays(data: any, path: string[] = []): RawCandidate[] {
      const candidates: RawCandidate[] = [];
  
      if (!data || typeof data !== "object") return candidates;
  
      if (Array.isArray(data)) {
        if (this.isMatrix(data)) {
          // 场景 6: 二维矩阵结构
          candidates.push({
            suggestedName: this.generateName(path),
            data,
            type: "MATRIX",
          });
        } else {
          // 场景 1, 2, 7: 普通数组或容器数组 (自动执行 flat 剥离外层容器)
          const flatData = data.flat(Infinity);
          if (flatData.length > 0) {
            candidates.push({
              suggestedName: this.generateName(path),
              data: flatData,
              type: "ARRAY",
            });
          }
        }
      } else {
        if (this.isMapStructure(data)) {
          // 场景 5: 对象包装表 (Map)
          candidates.push({
            suggestedName: this.generateName(path) || "map_data",
            data,
            type: "MAP",
          });
        } else {
          // 场景 3, 4: 普通嵌套对象，向下递归寻找
          for (const [key, value] of Object.entries(data)) {
            candidates.push(...this.findPotentialArrays(value, [...path, key]));
          }
        }
      }
  
      return candidates;
    }
  
    /**
     * 标准化逻辑：将所有类型的源数据清洗、转化为干净的 POJO 数组
     */
    private normalize(candidate: RawCandidate): Dataset {
      let rows: any[] = [];
  
      // 1. 结构解析
      if (candidate.type === "MATRIX") {
        const headers = candidate.data[0];
        for (let i = 1; i < candidate.data.length; i++) {
          const rowArr = candidate.data[i];
          if (Array.isArray(rowArr)) {
            const rowObj: any = {};
            headers.forEach((h: string | number, idx: number) => {
              rowObj[String(h)] = rowArr[idx];
            });
            rows.push(rowObj);
          }
        }
      } else if (candidate.type === "MAP") {
        for (const [key, value] of Object.entries(candidate.data)) {
          const row = { ...(value as object) };
          if (this.options.promoteMapKeys) {
            (row as any)["__key"] = key;
          }
          rows.push(row);
        }
      } else {
        rows = [...candidate.data];
      }
  
      // 2. 杂质清洗 (场景 8)
      if (this.options.ignoreImpurity) {
        rows = rows.filter(
          (r) => r && typeof r === "object" && !Array.isArray(r),
        );
      }
  
      // 3. 深层嵌套展平 (场景 10)
      if (this.options.flatten) {
        rows = rows.map((r) => this.flattenObject(r));
      }
  
      return {
        name: candidate.suggestedName,
        rows,
        origin: candidate.type.toLowerCase() as any,
      };
    }
  
    // --- 辅助与探测算法 ---
  
    private generateName(path: string[]): string {
      return path.length > 0 ? path.join("_") : "root_data";
    }
  
    /**
     * 启发式判断：是否为二维矩阵 (要求：至少两行，第一行全是基本类型列名)
     */
    private isMatrix(arr: any[]): boolean {
      if (arr.length < 2) return false;
      const head = arr[0];
      if (!Array.isArray(head)) return false;
      // 表头必须是全字符或数字
      const isHeaderValid = head.every(
        (h) => typeof h === "string" || typeof h === "number",
      );
      return isHeaderValid && Array.isArray(arr[1]);
    }
  
    /**
     * 启发式判断：是否为 Map 结构 (要求：纯对象，且内部的所有 Value 也必须是对象)
     */
    private isMapStructure(obj: any): boolean {
      if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
      const keys = Object.keys(obj);
  
      // 【修复点】：如果没有 key，或者只有一个 key，
      // 我们倾向于认为它是普通的嵌套路径，而不是 Map 结构的数据集。
      if (keys.length < 2) return false;
  
      for (const key of keys) {
        const val = obj[key];
        // 如果 Value 不是对象，或者是数组，说明它不是 Map 表
        if (!val || typeof val !== "object" || Array.isArray(val)) {
          return false;
        }
      }
      return true;
    }
  
    /**
     * 递归展平对象的嵌套结构
     */
    private flattenObject(obj: any, prefix = ""): any {
      let result: any = {};
      for (const [key, value] of Object.entries(obj)) {
        const newKey = prefix ? `${prefix}_${key}` : key;
        if (value && typeof value === "object" && !Array.isArray(value)) {
          Object.assign(result, this.flattenObject(value, newKey));
        } else {
          result[newKey] = value;
        }
      }
      return result;
    }
  }
  