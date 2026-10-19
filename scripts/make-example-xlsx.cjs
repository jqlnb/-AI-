const fs=require('node:fs');const path=require('node:path');const XLSX=require('xlsx');
const csv=fs.readFileSync(path.resolve(__dirname,'../examples/example_courses.csv'),'utf8');
const workbook=XLSX.read(csv,{type:'string'});
XLSX.writeFile(workbook,path.resolve(__dirname,'../examples/example_courses.xlsx'));
console.log('Created examples/example_courses.xlsx');
