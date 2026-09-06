(() => {
  const STATUS = { planned:'予定作成済み', exported:'CSV出力済み', held:'保留', executed:'実行済み', cancelled:'取消済み', active:'有効', partially_cancelled:'一部取消' };
  const CYCLES = { '05':'5日', '10':'10日', '15':'15日', '20':'20日', '25':'25日', end:'末日' };
  const DIRECTION = { incoming:'入金', outgoing:'出金' };
  const SHIFT_REASON = '土日祝のため営業日へ変更';
  const Cash = {
    async open(ctx) {
      this.ctx=ctx;
      this.kit=window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx.renderLoading();
      this.ym=this.kit.currentYearMonth();
      this.view='calendar';
      this.selected=new Set();
      this.filters={keyword:'',cycle:'',direction:'',status:''};
      this.selectedDate='';
      this.transferDate='';
      this.sourceAccountId='';
      this.holidays=new Set();
      this.balances={accounts:[],total_balance:0};
      this.ledgerEntries=[];
      this.layoutSaved=await this.kit.loadLayout('cash_management');
      await this.show();
    },
    status(v){return STATUS[v]||v||'未設定';},
    cycle(v){return CYCLES[v]||v;},
    date(v){return String(v||'').slice(0,10);},
    money(v){return this.kit.money(Number(v||0));},
    localDate(value=new Date()){
      const d=value instanceof Date?value:new Date(`${this.date(value)}T00:00:00`);
      if(Number.isNaN(d.getTime()))return '';
      return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    },
    businessDate(base, direction){
      const ymd=this.date(base);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(ymd))return ymd;
      const date=new Date(`${ymd}T00:00:00`);
      const step=direction==='outgoing'?-1:1;
      let guard=0;
      while(([0,6].includes(date.getDay())||this.holidays.has(this.localDate(date)))&&guard<31){
        date.setDate(date.getDate()+step);
        guard+=1;
      }
      return this.localDate(date);
    },
    shiftHint(from, to){
      if(!from||!to||from===to)return '';
      return `土日祝のため ${to} に変更しました（月をまたぐ場合があります）`;
    },
    cycleIdForDate(date, direction){
      const ymd=this.date(date);
      if(!ymd)return this.cycles[0]?.cash_cycle_id||'';
      const byBase=this.cycles.find(c=>this.date(c.base_date)===ymd);
      if(byBase)return byBase.cash_cycle_id;
      const key=direction==='outgoing'?'planned_outgoing_date':'planned_incoming_date';
      const shifted=this.businessDate(ymd, direction);
      const byPlanned=this.cycles.find(c=>this.date(c[key])===shifted||this.date(c[key])===ymd);
      if(byPlanned)return byPlanned.cash_cycle_id;
      return this.cycles[0]?.cash_cycle_id||'';
    },
    bankErrors(s){
      if(s.direction!=='outgoing')return[];
      const required=[['partner_id','支払先マスター'],['bank_code','銀行コード'],['bank_name','銀行名'],['branch_code','支店コード'],['branch_name','支店名'],['deposit_type','口座種別'],['account_number','口座番号'],['account_name_kana','口座名義カナ']];
      const errors=required.filter(([k])=>!String(s[k]??'').trim()).map(([,l])=>l);
      if(s.bank_code&&!/^\d{4}$/.test(s.bank_code))errors.push('銀行コード4桁');
      if(s.branch_code&&!/^\d{3}$/.test(s.branch_code))errors.push('支店コード3桁');
      return errors;
    },
    async show(message=''){
      this.ctx.renderLoading();
      const [c,s,e,o,b,l]=await Promise.all([
        this.ctx.api(`/api/cash-management/cycles?target_year_month=${this.ym}`),
        this.ctx.api(`/api/cash-management/schedules?target_year_month=${this.ym}`),
        this.ctx.api(`/api/cash-management/exports?target_year_month=${this.ym}`),
        this.ctx.api('/api/cash-management/bank-export-options'),
        this.ctx.api('/api/cash-management/balances'),
        this.ctx.api('/api/cash-management/ledger'),
      ]);
      if(!c.res.ok||!s.res.ok){
        this.ctx.app.innerHTML=this.kit.shell('入出金管理・FB出力','<section class="panel"><p class="error">データを取得できませんでした</p></section>');
        this.kit.bindShell();
        return;
      }
      this.cycles=c.data.cycles||[];
      this.holidays=new Set(c.data.holiday_dates||[]);
      this.schedules=s.data.schedules||[];
      this.batches=e.data?.batches||[];
      this.accounts=o.data?.accounts||[];
      this.balances=b.res.ok?b.data:{accounts:[],total_balance:0};
      this.ledgerEntries=l.res.ok?(l.data.entries||[]):[];
      this.selected=new Set([...this.selected].filter(id=>this.schedules.some(r=>Number(r.cash_schedule_id)===Number(id)&&r.status==='planned')));
      this.render(message);
    },
    monthRows(){
      const q=this.filters.keyword.toLowerCase();
      return this.schedules.filter(r=>
        (!this.filters.cycle||r.cycle_code===this.filters.cycle)&&
        (!this.filters.direction||r.direction===this.filters.direction)&&
        (!this.filters.status||r.status===this.filters.status)&&
        (!q||`${r.counterparty_name} ${r.title} ${r.bank_name||''}`.toLowerCase().includes(q))
      );
    },
    filtered(){
      return this.monthRows().filter(r=>!this.selectedDate||this.date(r.scheduled_date)===this.selectedDate);
    },
    selectedRows(){return this.schedules.filter(r=>this.selected.has(Number(r.cash_schedule_id)));},
    dayTone(date){
      const weekday=new Date(`${date}T00:00:00`).getDay();
      if(this.holidays.has(date)||weekday===0)return 'is-holiday';
      if(weekday===6)return 'is-saturday';
      return '';
    },
    render(message=''){
      const incoming=this.schedules.filter(r=>r.direction==='incoming'&&r.status!=='cancelled').reduce((n,r)=>n+Number(r.amount||0),0);
      const outgoing=this.schedules.filter(r=>r.direction==='outgoing'&&r.status!=='cancelled').reduce((n,r)=>n+Number(r.amount||0),0);
      const attention=this.schedules.filter(r=>r.status==='held'||this.bankErrors(r).length).length;
      const cards=this.kit.summaryCardsHtml([
        {label:'銀行預金 合計',value:this.money(this.balances.total_balance||0),tone:'complete',actionHtml:'<button type="button" class="btn btn-small cash-card-btn cash-card-btn-adjust" id="adjust-balance">口座調整</button>'},
        {label:'入金予定',value:this.money(incoming),tone:'complete',actionHtml:'<button type="button" class="btn btn-small cash-card-btn cash-card-btn-in" data-new-schedule="incoming">＋ 手動予定</button>'},
        {label:'出金予定',value:this.money(outgoing),tone:'attention',actionHtml:'<button type="button" class="btn btn-small cash-card-btn cash-card-btn-out" data-new-schedule="outgoing">＋ 手動予定</button>'},
        {label:'差引予定',value:this.money(incoming-outgoing),tone:'working'},
        {label:'要確認',value:attention,tone:'waiting'},
      ]);
      const cycleOptions=this.cycles.map(c=>`<option value="${c.cycle_code}" ${this.filters.cycle===c.cycle_code?'selected':''}>${this.cycle(c.cycle_code)}</option>`).join('');
      const filterbar=`<div class="cash-filterbar"><input id="cash-search" type="search" placeholder="支払先・件名・銀行を検索" value="${this.ctx.escapeHtml(this.filters.keyword)}"><select id="cash-cycle-filter"><option value="">すべての締日</option>${cycleOptions}</select><select id="cash-direction-filter"><option value="">入出金すべて</option><option value="incoming" ${this.filters.direction==='incoming'?'selected':''}>入金</option><option value="outgoing" ${this.filters.direction==='outgoing'?'selected':''}>出金</option></select><select id="cash-status-filter"><option value="">状態すべて</option>${['planned','exported','held','executed','cancelled'].map(v=>`<option value="${v}" ${this.filters.status===v?'selected':''}>${this.status(v)}</option>`).join('')}</select><span id="cash-date-filter">${this.selectedDate?`<button class="btn btn-ghost" id="clear-cash-date">${this.selectedDate} を解除</button>`:''}</span></div>`;
      this.ctx.app.innerHTML=this.kit.shell('入出金管理・FB出力',`<section class="cash-screen">${message?`<p class="flash">${this.ctx.escapeHtml(message)}</p>`:''}<div class="cash-topbar">${this.kit.monthNavigatorHtml(this.ym,'cash-month')}${filterbar}<div class="cash-view-toggle"><button class="btn ${this.view==='calendar'?'':'btn-ghost'}" data-view="calendar">カレンダー</button><button class="btn ${this.view==='list'?'':'btn-ghost'}" data-view="list">一覧</button></div></div>${cards}<div class="cash-workspace"><main class="cash-main">${this.view==='calendar'?this.calendarHtml():this.listHtml()}</main>${this.asideHtml()}</div><div id="modal-host"></div></section>`,{wide:true});
      this.kit.bindShell();
      this.bindCommon();
      if(this.view==='calendar')this.bindCalendar();
      else this.bindList();
      this.bindAside();
      if(this.view==='list')window.LinksListScreens?.applyScreenTable(document.getElementById('cash-schedule-table'),'cash_management','list',this.layoutSaved);
    },
    calendarHtml(){
      const[y,m]=this.ym.split('-').map(Number);
      const first=new Date(y,m-1,1).getDay();
      const last=new Date(y,m,0).getDate();
      const byDate=new Map();
      this.monthRows().forEach(r=>{
        const k=this.date(r.scheduled_date);
        if(!byDate.has(k))byDate.set(k,[]);
        byDate.get(k).push(r);
      });
      const cycleDates=new Map(this.cycles.map(c=>[this.date(c.base_date),this.cycle(c.cycle_code)]));
      const cells=[];
      for(let i=0;i<first;i++)cells.push('<div class="cash-calendar-day is-outside"></div>');
      for(let day=1;day<=last;day++){
        const d=`${this.ym}-${String(day).padStart(2,'0')}`;
        const rows=byDate.get(d)||[];
        const inc=rows.filter(r=>r.direction==='incoming'&&r.status!=='cancelled').reduce((n,r)=>n+Number(r.amount||0),0);
        const out=rows.filter(r=>r.direction==='outgoing'&&r.status!=='cancelled').reduce((n,r)=>n+Number(r.amount||0),0);
        const items=rows.slice(0,2).map(r=>`<small class="cash-calendar-item ${r.direction}">${this.ctx.escapeHtml(r.counterparty_name)} ${this.money(r.amount)}</small>`).join('');
        cells.push(`<button type="button" class="cash-calendar-day ${this.dayTone(d)} ${this.selectedDate===d?'is-selected':''}" data-calendar-date="${d}"><span class="cash-day-number">${day}</span>${cycleDates.has(d)?`<span class="cash-cycle-mark">${cycleDates.get(d)}</span>`:''}${inc?`<span class="cash-day-in">入 ${this.money(inc)}</span>`:''}${out?`<span class="cash-day-out">出 ${this.money(out)}</span>`:''}${items}${rows.length>2?`<small class="cash-more">ほか${rows.length-2}件</small>`:''}</button>`);
      }
      return`<section class="panel cash-calendar-panel"><div class="cash-weekdays">${['日','月','火','水','木','金','土'].map(d=>`<span>${d}</span>`).join('')}</div><div class="cash-calendar-grid">${cells.join('')}</div></section>`;
    },
    confirmLabel(r){
      if(r.direction!=='outgoing')return'<span class="muted">対象外</span>';
      const errors=this.bankErrors(r);
      if(!errors.length)return'<span class="status-text success">出力可能</span>';
      return`<span class="status-text warning" title="${this.ctx.escapeHtml(errors.join('、'))}">口座不備 ${errors.length}件</span><small class="cell-sub">${this.ctx.escapeHtml(errors.join('、'))}</small>`;
    },
    listHtml(){
      const rows=this.filtered().map(r=>{
        const eligible=r.direction==='outgoing'&&r.status==='planned';
        const actual=Number(r.executed_amount||0);
        const diff=actual-Number(r.amount||0);
        const actions=`${['planned','held'].includes(r.status)?`<button class="btn btn-ghost btn-small" data-edit="${r.cash_schedule_id}" data-date="${this.date(r.scheduled_date)}">変更</button>`:''}${['planned','exported','held'].includes(r.status)?`<button class="btn btn-ghost btn-small" data-exec="${r.cash_schedule_id}" data-amount="${r.amount}">実績</button>`:''}`;
        return`<tr><td><input type="checkbox" data-select-schedule="${r.cash_schedule_id}" ${this.selected.has(Number(r.cash_schedule_id))?'checked':''} ${eligible?'':'disabled'}></td><td data-col="cycle_code">${this.cycle(r.cycle_code)}</td><td data-col="scheduled_date">${this.date(r.scheduled_date)}</td><td data-col="direction"><span class="cash-direction-badge ${r.direction}">${DIRECTION[r.direction]||r.direction}</span></td><td data-col="counterparty"><strong>${this.ctx.escapeHtml(r.counterparty_name)}</strong><small class="cell-sub">${this.ctx.escapeHtml(r.title)}</small></td><td class="num" data-col="amount">${this.money(r.amount)}</td><td class="num" data-col="executed_amount">${actual?`${this.money(actual)}${diff?`<small class="cell-sub">差額 ${this.money(diff)}</small>`:''}`:'-'}</td><td data-col="bank">${r.direction==='outgoing'?`${this.ctx.escapeHtml(r.bank_name||'-')} ${this.ctx.escapeHtml(r.branch_name||'')}<small class="cell-sub">${r.account_number?`***${String(r.account_number).slice(-4)}`:''}</small>`:'-'}</td><td data-col="data_check">${this.confirmLabel(r)}</td><td data-col="status">${this.kit.statusBadge(r.status,this.status(r.status))}</td><td class="table-action-row cash-ops-cell">${actions}</td></tr>`;
      }).join('');
      return`<section class="panel"><div class="section-title-row"><div><h2>予定一覧</h2><p class="muted">銀行CSVは同じ締日の出金予定を選択してください。データ確認の口座不備は振込先の銀行コード・支店・口座番号などの不足です。</p></div><label class="check-item"><input type="checkbox" id="select-visible-schedules"><span>表示中を選択</span></label></div><div class="table-wrap"><table id="cash-schedule-table" class="data-table data-table-compact cash-schedule-table"><thead><tr><th>選択</th><th data-col="cycle_code">締日</th><th data-col="scheduled_date">予定日</th><th data-col="direction">入出金</th><th data-col="counterparty">相手先・件名</th><th data-col="amount">予定額</th><th data-col="executed_amount">実行額</th><th data-col="bank">振込先</th><th data-col="data_check">データ確認</th><th data-col="status">状態</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="11">予定がありません</td></tr>'}</tbody></table></div></section>`;
    },
    asideHtml(){
      const selected=this.selectedRows();
      const amount=selected.reduce((n,r)=>n+Number(r.amount||0),0);
      const errors=selected.reduce((n,r)=>n+this.bankErrors(r).length,0);
      const options=this.accounts.map(a=>`<option value="${a.source_bank_account_id}" ${String(this.sourceAccountId)===String(a.source_bank_account_id)?'selected':''} ${a.published_version_no?'':'disabled'}>${this.ctx.escapeHtml(a.account_label)}／${this.ctx.escapeHtml(a.bank_name)} ${this.ctx.escapeHtml(a.masked_account_number)}${a.published_version_no?`／v${a.published_version_no}`:'／未公開'}</option>`).join('');
      const raw=this.transferDate||this.date(this.cycles.find(c=>selected[0]&&Number(c.cash_cycle_id)===Number(selected[0].cash_cycle_id))?.planned_outgoing_date)||`${this.ym}-01`;
      const transferDate=this.businessDate(raw,'outgoing');
      this.transferDate=transferDate;
      const history=this.batches.slice(0,8).map(b=>`<li><div><strong>${this.ctx.escapeHtml(b.file_name)}</strong><small>${this.cycle(b.cycle_code)}／${b.item_count}件 ${b.export_kind==='bank_csv'?`／${this.ctx.escapeHtml(b.profile_name||'')} v${b.profile_version_no||'-'}`:'／確認用CSV'}</small></div><div class="table-action-row">${b.export_kind==='bank_csv'?`<button class="btn btn-ghost btn-small" data-download-export="${b.cash_export_batch_id}">再DL</button>`:''}${['active','partially_cancelled'].includes(b.status)?`<button class="btn btn-ghost btn-small" data-cancel-export="${b.cash_export_batch_id}">取消</button>`:''}</div></li>`).join('');
      const dayRows=this.selectedDate?this.monthRows().filter(r=>this.date(r.scheduled_date)===this.selectedDate):this.monthRows();
      const dayIn=dayRows.filter(r=>r.direction==='incoming'&&r.status!=='cancelled').reduce((n,r)=>n+Number(r.amount||0),0);
      const dayOut=dayRows.filter(r=>r.direction==='outgoing'&&r.status!=='cancelled').reduce((n,r)=>n+Number(r.amount||0),0);
      return`<aside class="cash-aside"><section class="panel"><h2>銀行CSV作成</h2><div class="cash-selected-summary"><span>選択 <strong>${selected.length}件</strong></span><span>合計 <strong>${this.money(amount)}</strong></span><span class="${errors?'error':''}">不備 <strong>${errors}件</strong></span></div><label>振込元口座</label><select id="source-bank-account"><option value="">選択してください</option>${options}</select><label>振込指定日</label><input id="bank-transfer-date" type="date" value="${transferDate}"><button class="btn cash-export-button" id="preview-bank-export" ${selected.length&&this.accounts.some(a=>a.published_version_no)?'':'disabled'}>選択分のCSVを確認</button>${!this.accounts.length?'<p class="muted">マスター設定で振込元口座と公開済みCSV版を登録してください。</p>':''}</section><section class="panel"><h2>${this.selectedDate?`${this.selectedDate} の予定`:'月間サマリー'}</h2><div class="cash-selected-summary"><span>入金 <strong>${this.money(dayIn)}</strong></span><span>出金 <strong>${this.money(dayOut)}</strong></span><span>差引 <strong>${this.money(dayIn-dayOut)}</strong></span></div><p class="muted">クリックは強調のみ。ダブルクリックでその日の一覧へ移ります。</p></section><section class="panel cash-history"><h2>最近の出力</h2><ul>${history||'<li class="muted">出力履歴がありません</li>'}</ul></section></aside>`;
    },
    bindCommon(){
      this.kit.bindMonthNavigator('cash-month',()=>this.ym,v=>{this.ym=v;this.selected.clear();this.selectedDate='';this.transferDate='';},()=>this.show());
      document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{this.view=b.dataset.view;this.render();});
      const search=document.getElementById('cash-search');
      search.oninput=e=>{this.filters.keyword=e.target.value;};
      search.onchange=()=>this.render();
      for(const[id,key]of[['cash-cycle-filter','cycle'],['cash-direction-filter','direction'],['cash-status-filter','status']]){
        document.getElementById(id).onchange=e=>{this.filters[key]=e.target.value;this.render();};
      }
      document.getElementById('clear-cash-date')?.addEventListener('click',()=>{this.selectedDate='';this.render();});
      document.getElementById('adjust-balance')?.addEventListener('click',(e)=>{e.preventDefault();this.ledgerEditor();});
      document.querySelectorAll('[data-new-schedule]').forEach(b=>b.addEventListener('click',(e)=>{e.preventDefault();this.editor(b.dataset.newSchedule);}));
    },
    refreshDateSelection(){
      document.querySelectorAll('[data-calendar-date]').forEach((el)=>{
        el.classList.toggle('is-selected', el.dataset.calendarDate===this.selectedDate);
      });
      const filter=document.getElementById('cash-date-filter');
      if(filter){
        filter.innerHTML=this.selectedDate?`<button class="btn btn-ghost" id="clear-cash-date">${this.selectedDate} を解除</button>`:'';
        document.getElementById('clear-cash-date')?.addEventListener('click',()=>{this.selectedDate='';this.render();});
      }
      const aside=document.querySelector('.cash-aside');
      if(aside){
        aside.outerHTML=this.asideHtml();
        this.bindAside();
      }
    },
    bindCalendar(){
      document.querySelectorAll('[data-calendar-date]').forEach(b=>{
        b.onclick=()=>{
          const date=b.dataset.calendarDate;
          this.selectedDate=this.selectedDate===date?'':date;
          this.refreshDateSelection();
        };
        b.ondblclick=(ev)=>{
          ev.preventDefault();
          this.selectedDate=b.dataset.calendarDate;
          this.view='list';
          this.render();
        };
      });
    },
    bindList(){
      document.querySelectorAll('[data-select-schedule]').forEach(c=>c.onchange=()=>{
        const id=Number(c.dataset.selectSchedule);
        const row=this.schedules.find(r=>Number(r.cash_schedule_id)===id);
        const chosen=this.selectedRows();
        if(c.checked&&chosen.length&&chosen.some(r=>Number(r.cash_cycle_id)!==Number(row.cash_cycle_id))){
          c.checked=false;
          return window.alert('銀行CSVは同じ締日の予定だけを選択してください');
        }
        if(c.checked)this.selected.add(id);else this.selected.delete(id);
        this.render();
      });
      document.getElementById('select-visible-schedules')?.addEventListener('change',e=>{
        if(!e.target.checked)this.filtered().forEach(r=>this.selected.delete(Number(r.cash_schedule_id)));
        else{
          const eligible=this.filtered().filter(r=>r.direction==='outgoing'&&r.status==='planned');
          const cycleId=this.selectedRows()[0]?.cash_cycle_id||eligible[0]?.cash_cycle_id;
          eligible.filter(r=>Number(r.cash_cycle_id)===Number(cycleId)).forEach(r=>this.selected.add(Number(r.cash_schedule_id)));
        }
        this.render();
      });
      document.querySelectorAll('[data-exec]').forEach(b=>b.onclick=()=>this.transaction(Number(b.dataset.exec),Number(b.dataset.amount)));
      document.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>this.editSchedule(Number(b.dataset.edit),b.dataset.date));
    },
    snapTransferDate(){
      const input=document.getElementById('bank-transfer-date');
      if(!input?.value)return;
      const next=this.businessDate(input.value,'outgoing');
      if(next!==input.value)input.value=next;
      this.transferDate=input.value;
    },
    bindAside(){
      document.getElementById('source-bank-account')?.addEventListener('change',e=>{this.sourceAccountId=e.target.value;});
      document.getElementById('bank-transfer-date')?.addEventListener('change',()=>this.snapTransferDate());
      this.snapTransferDate();
      document.getElementById('preview-bank-export')?.addEventListener('click',()=>this.preview());
      document.querySelectorAll('[data-download-export]').forEach(b=>b.onclick=async()=>{
        const r=await fetch(`/api/cash-management/exports/${b.dataset.downloadExport}/download`,{credentials:'include'});
        if(!r.ok)return this.responseError(r,'再ダウンロードできませんでした');
        this.download(r);
      });
      document.querySelectorAll('[data-cancel-export]').forEach(b=>b.onclick=async()=>{
        if(!window.confirm('このCSV出力を取り消し、未実行予定を出力前へ戻しますか？'))return;
        const r=await this.ctx.api(`/api/cash-management/exports/${b.dataset.cancelExport}/cancel`,{method:'POST',body:JSON.stringify({reason:'画面からCSV出力取消'})});
        if(!r.res.ok)return window.alert(r.data?.message||'取消できませんでした');
        this.selected.clear();
        await this.show('CSV出力を取り消しました');
      });
    },
    async preview(){
      this.snapTransferDate();
      const payload={schedule_ids:[...this.selected],source_bank_account_id:Number(document.getElementById('source-bank-account').value),transfer_date:document.getElementById('bank-transfer-date').value};
      if(!payload.source_bank_account_id)return window.alert('振込元口座を選択してください');
      const r=await this.ctx.api('/api/cash-management/bank-exports/preview',{method:'POST',body:JSON.stringify(payload)});
      if(!r.res.ok)return window.alert(r.data?.message||'プレビューを作成できませんでした');
      const d=r.data;
      if(d.transfer_date){this.transferDate=d.transfer_date;payload.transfer_date=d.transfer_date;}
      const rows=d.rows.map(row=>`<tr>${row.values.map(v=>`<td>${this.ctx.escapeHtml(v)}</td>`).join('')}</tr>`).join('');
      const errors=d.errors.map(e=>`<li>予定 #${e.cash_schedule_id}：${this.ctx.escapeHtml(e.message)}</li>`).join('');
      document.getElementById('modal-host').innerHTML=this.kit.modalHtml('銀行CSVプレビュー',`<p><strong>${this.ctx.escapeHtml(d.profile.name)} v${d.profile.version_no}</strong>／${this.ctx.escapeHtml(d.source_account.account_label)}</p><div class="cash-selected-summary"><span>${d.total_count}件</span><span>${this.money(d.total_amount)}</span><span class="${d.errors.length?'error':''}">不備 ${d.errors.length}件</span></div>${errors?`<ul class="error-list">${errors}</ul>`:''}<div class="table-wrap bank-preview-table"><table class="data-table data-table-compact"><thead><tr>${d.columns.map(c=>`<th>${this.ctx.escapeHtml(c.label)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table></div>`,d.errors.length?'<button class="btn btn-ghost" data-modal-close>一覧へ戻る</button>':'<button class="btn" id="generate-bank-export">CSVを生成してダウンロード</button>','modal-wide');
      this.kit.bindModal();
      document.getElementById('generate-bank-export')?.addEventListener('click',()=>this.generate(payload));
    },
    async generate(payload){
      const b=document.getElementById('generate-bank-export');
      b.disabled=true;b.textContent='生成中…';
      const r=await fetch('/api/cash-management/bank-exports',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      if(!r.ok){b.disabled=false;b.textContent='CSVを生成してダウンロード';return this.responseError(r,'CSVを生成できませんでした');}
      await this.download(r);
      document.getElementById('modal-backdrop')?.remove();
      this.selected.clear();
      await this.show('銀行CSVを作成しました。銀行処理後に実績を登録してください。');
    },
    async responseError(r,fallback){try{const d=await r.json();window.alert(d.message||fallback);}catch(_e){window.alert(fallback);}},
    async download(r){
      const d=r.headers.get('Content-Disposition')||'';
      const encoded=d.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const name=encoded?decodeURIComponent(encoded):'bank-export.csv';
      const url=URL.createObjectURL(await r.blob());
      const a=document.createElement('a');a.href=url;a.download=name;a.click();URL.revokeObjectURL(url);
    },
    cycleOptions(selected='', direction='outgoing'){
      const key=direction==='outgoing'?'planned_outgoing_date':'planned_incoming_date';
      const label=direction==='outgoing'?'出金':'入金';
      return this.cycles.map(c=>`<option value="${c.cash_cycle_id}" ${Number(selected)===Number(c.cash_cycle_id)?'selected':''}>${this.cycle(c.cycle_code)}（${label} ${this.date(c[key])}）</option>`).join('');
    },
    bindDateShift(root, directionGetter){
      const dateInput=root.querySelector('[name="scheduled_date"]');
      const reason=root.querySelector('[name="override_reason"]');
      const hint=root.querySelector('#cash-date-shift-hint');
      const apply=()=>{
        if(!dateInput?.value){if(hint)hint.textContent='';return;}
        const from=dateInput.value;
        const next=this.businessDate(from, directionGetter());
        if(next!==from){
          dateInput.value=next;
          if(hint)hint.textContent=this.shiftHint(from,next);
          if(reason&&!String(reason.value||'').trim())reason.value=SHIFT_REASON;
        }
      };
      dateInput?.addEventListener('change',apply);
      root.querySelector('[name="direction"]')?.addEventListener('change',apply);
      apply();
    },
    async afterSave(message, scheduledDate){
      const ymd=this.date(scheduledDate);
      if(ymd&&ymd.slice(0,7)!==this.ym){
        this.ym=ymd.slice(0,7);
        this.selectedDate=ymd;
      }
      await this.show(message);
    },
    editor(direction='outgoing'){
      const dir=direction==='incoming'?'incoming':'outgoing';
      const source=this.selectedDate||'';
      const scheduled=source?this.businessDate(source,dir):'';
      const hint=this.shiftHint(source,scheduled);
      const cycleId=this.cycleIdForDate(source||scheduled,dir);
      const body=`<form id="cash-form"><div class="form-grid form-grid-compact"><div><label>締日</label><select name="cash_cycle_id">${this.cycleOptions(cycleId,dir)}</select></div><div><label>区分</label><select name="direction"><option value="incoming" ${dir==='incoming'?'selected':''}>入金</option><option value="outgoing" ${dir==='outgoing'?'selected':''}>出金</option></select></div><div><label>相手先</label><input name="counterparty_name" required></div><div><label>件名</label><input name="title" required></div><div><label>金額</label><input name="amount" type="number" min="1" required></div><div><label>個別予定日</label><input name="scheduled_date" type="date" value="${scheduled}"></div><div class="full"><label>日付変更理由</label><input name="override_reason" value="${hint?SHIFT_REASON:''}"></div></div><p class="muted" id="cash-date-shift-hint">${this.ctx.escapeHtml(hint)}</p></form>`;
      document.getElementById('modal-host').innerHTML=this.kit.modalHtml('手動予定',body,'<button class="btn" form="cash-form">登録</button><button type="button" class="btn btn-ghost" data-modal-close>キャンセル</button>');
      const form=document.getElementById('cash-form');
      this.kit.bindModal();
      this.bindDateShift(form,()=>form.querySelector('[name="direction"]').value);
      form.onsubmit=async ev=>{
        ev.preventDefault();
        const payload=Object.fromEntries(new FormData(ev.currentTarget));
        if(payload.scheduled_date)payload.scheduled_date=this.businessDate(payload.scheduled_date,payload.direction);
        const r=await this.ctx.api('/api/cash-management/schedules',{method:'POST',body:JSON.stringify(payload)});
        if(!r.res.ok)return window.alert(r.data?.message||'登録失敗');
        await this.afterSave('予定を登録しました', r.data.scheduled_date||payload.scheduled_date);
      };
    },
    editSchedule(id,date){
      const row=this.schedules.find(r=>Number(r.cash_schedule_id)===id);
      const dir=row?.direction||'outgoing';
      const scheduled=this.businessDate(date,dir);
      const hint=this.shiftHint(date,scheduled);
      const body=`<form id="cash-edit-form"><div class="form-grid form-grid-compact"><div><label>締日</label><select name="cash_cycle_id">${this.cycleOptions(row?.cash_cycle_id,dir)}</select></div><div><label>個別予定日</label><input name="scheduled_date" type="date" value="${scheduled}" required></div><div class="full"><label>変更理由</label><input name="override_reason" value="${hint?SHIFT_REASON:''}" required></div></div><p class="muted" id="cash-date-shift-hint">${this.ctx.escapeHtml(hint)}</p></form>`;
      document.getElementById('modal-host').innerHTML=this.kit.modalHtml('予定変更',body,'<button class="btn" form="cash-edit-form">変更を保存</button><button type="button" class="btn btn-ghost" data-modal-close>キャンセル</button>');
      const form=document.getElementById('cash-edit-form');
      this.kit.bindModal();
      this.bindDateShift(form,()=>dir);
      form.onsubmit=async ev=>{
        ev.preventDefault();
        const payload=Object.fromEntries(new FormData(ev.currentTarget));
        payload.scheduled_date=this.businessDate(payload.scheduled_date,dir);
        const r=await this.ctx.api(`/api/cash-management/schedules/${id}`,{method:'PUT',body:JSON.stringify(payload)});
        if(!r.res.ok)return window.alert(r.data?.message||'変更失敗');
        await this.afterSave('予定を変更しました', payload.scheduled_date);
      };
    },
    transaction(id,planned){
      const local=this.localDate();
      const body=`<form id="cash-actual-form"><div class="form-grid form-grid-compact"><div><label>処理</label><select name="status" id="cash-actual-status"><option value="executed">実行</option><option value="held">保留</option><option value="cancelled">取消</option></select></div><div><label>実行日</label><input name="executed_date" type="date" value="${local}" required></div><div><label>実行額</label><input name="executed_amount" type="number" min="0" step="1" value="${planned}"></div><div class="full"><label>理由（保留・取消は必須）</label><input name="reason"></div></div></form>`;
      document.getElementById('modal-host').innerHTML=this.kit.modalHtml('実績',body,'<button class="btn" form="cash-actual-form">登録</button><button type="button" class="btn btn-ghost" data-modal-close>キャンセル</button>');
      this.kit.bindModal();
      const form=document.getElementById('cash-actual-form');
      const status=document.getElementById('cash-actual-status');
      const amount=form.querySelector('[name="executed_amount"]');
      const date=form.querySelector('[name="executed_date"]');
      const sync=()=>{
        const executed=status.value==='executed';
        amount.disabled=!executed;
        date.disabled=!executed;
      };
      status.onchange=sync;sync();
      form.onsubmit=async ev=>{
        ev.preventDefault();
        const data=Object.fromEntries(new FormData(ev.currentTarget));
        if(data.status!=='executed'&&!String(data.reason||'').trim())return window.alert('保留・取消には理由を入力してください');
        const r=await this.ctx.api(`/api/cash-management/schedules/${id}/transaction`,{method:'POST',body:JSON.stringify({executed_date:data.executed_date||local,executed_amount:data.status==='executed'?Number(data.executed_amount):0,status:data.status,reason:data.reason})});
        if(!r.res.ok)return window.alert(r.data?.message||'登録失敗');
        await this.show(data.status==='executed'?'実績を登録しました':data.status==='held'?'保留にしました':'取消しました');
      };
    },
    ledgerEditor(){
      const accountOptions=(this.balances.accounts||[]).map(a=>`<option value="${a.source_bank_account_id}">${this.ctx.escapeHtml(a.account_label)}（残高 ${this.money(a.balance)}）</option>`).join('');
      const summary=(this.balances.accounts||[]).map(a=>`<span>${this.ctx.escapeHtml(a.account_label)}<strong>${this.money(a.balance)}</strong></span>`).join('')||'<span class="muted">口座がありません</span>';
      const rows=this.ledgerEntries.slice(0,12).map(r=>`<tr><td>${this.date(r.entry_date)}</td><td>${this.ctx.escapeHtml(r.account_label)}</td><td><span class="cash-direction-badge ${r.direction}">${DIRECTION[r.direction]}</span></td><td class="num">${this.money(r.amount)}</td><td>${this.ctx.escapeHtml(r.memo||'')}</td><td class="table-action-row"><button type="button" class="btn btn-ghost btn-small" data-del-ledger="${r.source_bank_ledger_entry_id}">取消</button></td></tr>`).join('');
      const entryDate=this.selectedDate||this.localDate();
      const body=`<p class="muted">請求・支払の予定とは別に、自社口座の預金残高だけを増減します。期首残高はマスター設定の振込元口座で変更します。</p><div class="cash-selected-summary">${summary}</div><form id="cash-ledger-form"><div class="form-grid form-grid-compact"><div><label>口座</label><select name="source_bank_account_id" required>${accountOptions||'<option value="">口座がありません</option>'}</select></div><div><label>日付</label><input name="entry_date" type="date" value="${entryDate}" required></div><div><label>区分</label><select name="direction"><option value="incoming">入金</option><option value="outgoing">出金</option></select></div><div><label>金額</label><input name="amount" type="number" min="1" step="1" required></div><div class="full"><label>摘要</label><input name="memo"></div></div></form><div class="table-wrap" style="margin-top:12px"><table class="data-table data-table-compact"><thead><tr><th>日付</th><th>口座</th><th>入出金</th><th>金額</th><th>摘要</th><th>操作</th></tr></thead><tbody>${rows||'<tr><td colspan="6">調整入出金はありません</td></tr>'}</tbody></table></div>`;
      document.getElementById('modal-host').innerHTML=this.kit.modalHtml('口座調整',body,'<button class="btn" form="cash-ledger-form">残高を調整</button><button type="button" class="btn btn-ghost" data-modal-close>キャンセル</button>','modal-wide');
      this.kit.bindModal();
      document.getElementById('cash-ledger-form').onsubmit=async ev=>{
        ev.preventDefault();
        const r=await this.ctx.api('/api/cash-management/ledger',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(ev.currentTarget)))});
        if(!r.res.ok)return window.alert(r.data?.message||'登録失敗');
        await this.show('口座残高を調整しました');
      };
      document.querySelectorAll('[data-del-ledger]').forEach(b=>b.onclick=async()=>{
        if(!window.confirm('この調整入出金を取り消しますか？'))return;
        const r=await this.ctx.api(`/api/cash-management/ledger/${b.dataset.delLedger}`,{method:'DELETE'});
        if(!r.res.ok)return window.alert(r.data?.message||'取消できませんでした');
        await this.show('調整入出金を取り消しました');
      });
    },
  };
  window.LinksCashManagement=Cash;
})();
