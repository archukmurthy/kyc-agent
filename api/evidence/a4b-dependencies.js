"use strict";
const {createPostgresDb}=require("../../evidence/a2/postgresDb");const {PostgresA4bRepository}=require("../../evidence/a4b/repository");
function dependencies(){if(!process.env.DATABASE_URL)throw Object.assign(new Error("A4b requires DATABASE_URL and migration 018"),{statusCode:503});const db=createPostgresDb();return{repository:new PostgresA4bRepository(db),close:()=>db.close()};}
module.exports={dependencies};
