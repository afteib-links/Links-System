// Read frozen settlement sources, never today's mutable daily reports.
async function settlementAttendance(conn,kind,id){
  const [rows]=await conn.query(`SELECT DISTINCT s.daily_report_id,
    JSON_UNQUOTE(JSON_EXTRACT(s.snapshot_json,'$.work_date')) work_date,
    JSON_UNQUOTE(JSON_EXTRACT(s.snapshot_json,'$.work_hours')) work_hours,
    JSON_UNQUOTE(JSON_EXTRACT(s.snapshot_json,'$.is_absent')) is_absent
    FROM settlement_line_sources s JOIN settlement_lines l ON l.settlement_line_id=s.settlement_line_id
    WHERE l.settlement_type=? AND l.settlement_id=? AND l.status='active'`,[kind,id]);
  const working=rows.filter(r=>Number(r.is_absent)!==1&&Number(r.work_hours)>0);
  return {work_days:new Set(working.map(r=>r.work_date)).size,work_minutes:working.reduce((n,r)=>n+Number(r.work_hours)*60,0)};
}
module.exports={settlementAttendance};
