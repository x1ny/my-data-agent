import { writeFileSync, unlinkSync, readdir, readdirSync, existsSync } from "node:fs";
import { Database } from "bun:sqlite";
import { csvToSqlite, jsonObjectToSqlite, flattenObject } from "./agent";
import path from "node:path";

const inputDir = Bun.env.INPUT_DIR || path.join(__dirname, '../input');
const outputDir = Bun.env.OUTPUT_DIR || path.join(__dirname, '../output');

const entries = readdirSync(inputDir, { withFileTypes: true });
    
    // 过滤掉文件，只保留文件夹名称
const taskNames = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
for (const taskName of taskNames) {
  let db: Database | undefined;

  try {

    const task_json = await Bun.file(path.join(inputDir, taskName, 'task.json')).json() as {
      task_id: string;
      difficulty: string;
      question: string;
    };

    console.log("开始处理任务:", taskName);
    console.log("任务ID:", task_json.task_id);
    console.log("任务难度:", task_json.difficulty);
    console.log("任务问题:", task_json.question);

    db = new Database(':memory:');

    const context_dir = path.join(inputDir, taskName, 'context');

    if (existsSync(path.join(context_dir, 'csv'))) {
      const csv_files = readdirSync( path.join(context_dir, 'csv'), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.csv'))
      console.log('存在csv文件:', csv_files.map(entry => entry.name))
      for (const csv_file of csv_files) {
        await csvToSqlite(db, path.join(context_dir, 'csv', csv_file.name), {
          tableName: csv_file.name.split('.')[0] || csv_file.name,
        });
      }
    }

    if (existsSync(path.join(context_dir, 'json'))) {
      const json_files = readdirSync( path.join(context_dir, 'json'), { withFileTypes: true }).filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      console.log('存在json文件:', json_files.map(entry => entry.name))
      for (const json_file of json_files) {
        const json_data = await Bun.file(path.join(context_dir, 'json', json_file.name)).json();
        if (json_data.records && json_data.table) {
          await jsonObjectToSqlite(db, json_data.records, {
            tableName: json_data.table,
          });
        }
      }
    }

    //打印出db的表名
    console.log(db.query(`SELECT name FROM sqlite_master WHERE type='table'`).all());
    console.log("--------------------------------");

    // console.log()
  } catch (error) {
    console.error("处理任务失败:", taskName, error);
  } finally {
    db?.close();
  }
}
// const db = new Database(":memory:");

// const result = await csvToSqlite(db,path.join(__dirname, './budget.csv'), {
//   tableName: 'budget',
// });



// const rows = db.query(`SELECT * FROM budget LIMIT 1`).all();
// console.log(rows);


// const patient = await Bun.file(path.join(__dirname, './Patient.json')).json();
// const patientResult = await jsonObjectToSqlite(db, patient.records, {
//   tableName: 'patient',
// });

// // console.log(patientResult);

// const patientRows = db.query(`SELECT * FROM patient LIMIT 1`).all();
// console.log(patientRows);

