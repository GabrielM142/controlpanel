import pg from 'pg';
export const db=new pg.Pool({connectionString:process.env.DATABASE_URL,max:3,connectionTimeoutMillis:5000});
