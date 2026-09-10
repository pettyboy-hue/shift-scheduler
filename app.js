/**
 * 排班助手前端 v5
 * 
 * 核心原则：
 * 1. 班次永远不变——晚班的人永远上晚班，绝不会出现在早班
 * 2. 大小休直观展示——每人右侧大字显示🟢连休/🟡单休/🟠拆休/🔴无休
 * 3. 小休拆半——同班次一半周六休一半周日休
 * 4. 点击即可微调，每次修改实时刷新分析
 */
(function () {
    'use strict';

    var EMPLOYEES = [
        { name: '罗凯', shift: 'morning' },
        { name: '陈力', shift: 'middle' },
        { name: '柳鹏', shift: 'middle' },
        { name: '袁继春', shift: 'night' },
        { name: '罗浩文', shift: 'night' },
        { name: '陈阳倩', shift: 'night' },
        { name: '罗森鹏', shift: 'night' }
    ];

    var SHIFT_CN = { morning: '早', middle: '中', night: '晚' };
    var SHIFT_EMOJI = { morning: '☀️', middle: '🌤️', night: '🌙' };
    var DAYS_CN = ['日', '一', '二', '三', '四', '五', '六'];

    var state = {
        scheduler: null,
        result: null,
        view: 'person',
        specials: {}
    };

    var $ = function (id) { return document.getElementById(id); };

    /* ========== 初始化 ========== */
    function init() {
        // 默认本周一
        var today = new Date();
        var dow = today.getDay();
        var diff = dow === 0 ? -6 : 1 - dow;
        var mon = new Date(today);
        mon.setDate(today.getDate() + diff);
        $('weekStart').value = fmt(mon);

        $('generateBtn').addEventListener('click', generate);
        $('exportBtn').addEventListener('click', exportCSV);
        $('copyBtn').addEventListener('click', copyText);

        document.querySelectorAll('.vbtn').forEach(function (b) {
            b.addEventListener('click', function () {
                state.view = this.dataset.view;
                document.querySelectorAll('.vbtn').forEach(function (x) { x.classList.remove('active'); });
                this.classList.add('active');
                renderTable();
            });
        });

        $('weekStart').addEventListener('change', renderSpecials);
        $('weekType').addEventListener('change', renderSpecials);

        renderSpecials();
    }

    /* ========== 特殊情况面板 ========== */
    function renderSpecials() {
        var ws = $('weekStart').value;
        if (!ws) return;
        var dates = buildDates(ws);

        var html = '';
        EMPLOYEES.forEach(function (emp) {
            var sp = state.specials[emp.name];
            html += '<div class="sp-row">';
            html += '<div class="sp-name">' + emp.name + ' <small class="sp-shift ' + emp.shift + '">' + SHIFT_CN[emp.shift] + '班</small></div>';
            html += '<select class="sp-type" data-name="' + emp.name + '">';
            html += '<option value="none"' + (!sp ? ' selected' : '') + '>正常</option>';
            html += '<option value="dayoff"' + (sp && sp.type === 'dayoff' ? ' selected' : '') + '>调休</option>';
            html += '<option value="leave"' + (sp && sp.type === 'leave' ? ' selected' : '') + '>请假</option>';
            html += '</select>';
            html += '<div class="sp-dates" data-name="' + emp.name + '"' + (!sp ? ' style="display:none"' : '') + '>';
            dates.forEach(function (d) {
                var checked = sp && sp.days && sp.days.indexOf(d.date) >= 0;
                html += '<label class="sp-date-lbl"><input type="checkbox" value="' + d.date + '" data-emp="' + emp.name + '"' + (checked ? ' checked' : '') + '>' + d.short + '</label>';
            });
            html += '</div></div>';
        });

        $('specialArea').innerHTML = html;

        // 绑定事件
        $('specialArea').querySelectorAll('.sp-type').forEach(function (sel) {
            sel.addEventListener('change', function () {
                var name = this.dataset.name;
                var type = this.value;
                var dDiv = $('specialArea').querySelector('.sp-dates[data-name="' + name + '"]');
                if (type === 'none') {
                    delete state.specials[name];
                    dDiv.style.display = 'none';
                } else {
                    if (!state.specials[name]) state.specials[name] = { type: type, days: [] };
                    state.specials[name].type = type;
                    dDiv.style.display = 'flex';
                }
            });
        });

        $('specialArea').querySelectorAll('input[type=checkbox]').forEach(function (cb) {
            cb.addEventListener('change', function () {
                var name = this.dataset.emp;
                var date = this.value;
                if (!state.specials[name]) state.specials[name] = { type: 'dayoff', days: [] };
                if (this.checked) {
                    if (state.specials[name].days.indexOf(date) < 0) state.specials[name].days.push(date);
                } else {
                    state.specials[name].days = state.specials[name].days.filter(function (x) { return x !== date; });
                }
            });
        });
    }

    /* ========== 生成排班 ========== */
    function generate() {
        var ws = $('weekStart').value;
        if (!ws) { toast('请选择日期'); return; }

        state.scheduler = new ShiftScheduler({
            employees: EMPLOYEES.slice(),
            weekStart: ws,
            weekType: $('weekType').value,
            bizLevel: $('bizLevel').value,
            specials: JSON.parse(JSON.stringify(state.specials))
        });

        state.result = state.scheduler.generate();
        $('resultArea').style.display = 'block';
        var typeText = $('weekType').value === 'big' ? '大休（双休）' : '小休（单休）';
        $('resultTitle').textContent = '📅 ' + state.result.dates[0] + ' ~ ' + state.result.dates[6] + '  ' + typeText;
        renderAll();
        toast('排班生成成功！');
    }

    function renderAll() {
        renderTable();
        renderWarnings();
        renderAnalysis();
    }

    /* ========== 人员视图 ========== */
    function renderTable() {
        if (!state.result) return;
        if (state.view === 'person') renderPersonView();
        else renderShiftView();
    }

    function renderPersonView() {
        var r = state.result;
        var a = r.analysis;

        var html = '<table class="ptable"><thead><tr>';
        html += '<th class="col-name">姓名</th>';
        html += '<th class="col-shift">班次</th>';
        r.dates.forEach(function (d) {
            var m = r.meta[d];
            var cls = m.isWeekend ? ' we' : '';
            html += '<th class="col-day' + cls + '">' + m.label + '<br><small>周' + m.dayName + '</small></th>';
        });
        html += '<th class="col-stat">工作</th>';
        html += '<th class="col-stat">休息</th>';
        html += '<th class="col-status">本周状态</th>';
        html += '</tr></thead><tbody>';

        // 按班次分组显示
        ['morning', 'middle', 'night'].forEach(function (shift) {
            var emps = EMPLOYEES.filter(function (e) { return e.shift === shift; });
            emps.forEach(function (emp, idx) {
                var p = a.persons[emp.name];
                html += '<tr class="prow ' + shift + '-row">';
                html += '<td class="col-name">' + emp.name + '</td>';
                html += '<td class="col-shift"><span class="shift-badge ' + shift + '">' + SHIFT_EMOJI[shift] + SHIFT_CN[shift] + '</span></td>';

                r.dates.forEach(function (d) {
                    var isRest = r.schedule[d].rest.indexOf(emp.name) >= 0;
                    var m = r.meta[d];
                    var cls = 'dcell' + (m.isWeekend ? ' we' : '');
                    html += '<td class="' + cls + '" data-name="' + emp.name + '" data-date="' + d + '">';
                    if (isRest) {
                        html += '<span class="badge rest">休</span>';
                    } else {
                        html += '<span class="badge ' + shift + '">' + SHIFT_CN[shift] + '</span>';
                    }
                    html += '</td>';
                });

                // 统计
                html += '<td class="col-stat">' + p.workDays.length + '天</td>';
                html += '<td class="col-stat">' + p.restDays.length + '天</td>';

                // 休息状态大标签
                html += '<td class="col-status">';
                html += '<span class="rest-label ' + p.restType + '">' + p.restEmoji + ' ' + p.restText + '</span>';
                if (p.issues.length > 0) {
                    var worst = p.issues.some(function (i) { return i.lv === 'danger'; });
                    html += '<span class="issue-badge ' + (worst ? 'danger' : 'warn') + '">' + p.issues.length + '</span>';
                }
                html += '</td>';
                html += '</tr>';
            });
        });

        html += '</tbody></table>';
        $('tableArea').innerHTML = html;
        bindTableClicks();
    }

    /* ========== 班次视图 ========== */
    function renderShiftView() {
        var r = state.result;

        var html = '<table class="stable"><thead><tr><th class="col-shift-name">班次</th>';
        r.dates.forEach(function (d) {
            var m = r.meta[d];
            var cls = m.isWeekend ? ' we' : '';
            html += '<th class="' + cls + '">' + m.label + '<br><small>周' + m.dayName + '</small></th>';
        });
        html += '</tr></thead><tbody>';

        ['morning', 'middle', 'night'].forEach(function (shift) {
            var cfg = ShiftScheduler.SHIFTS[shift];
            html += '<tr class="srow">';
            html += '<td class="sname ' + shift + '">' + cfg.fullLabel + '<br><small>' + cfg.time + '</small></td>';

            r.dates.forEach(function (d) {
                var people = r.schedule[d][shift];
                var m = r.meta[d];
                var cls = m.isWeekend ? ' we' : '';
                html += '<td class="scell' + cls + '">';
                html += '<div class="scell-count">' + people.length + '/' + cfg.weekdayNeed + '人</div>';
                if (people.length === 0) {
                    html += '<div class="scell-empty">—</div>';
                } else {
                    people.forEach(function (n) {
                        html += '<div class="scell-person ' + shift + '" data-name="' + n + '" data-date="' + d + '">' + n + '</div>';
                    });
                }
                html += '</td>';
            });
            html += '</tr>';
        });

        // 休息行
        html += '<tr class="srow rest-srow"><td class="sname rest-name">😴 休息</td>';
        r.dates.forEach(function (d) {
            var rest = r.schedule[d].rest;
            var m = r.meta[d];
            var cls = m.isWeekend ? ' we' : '';
            html += '<td class="scell' + cls + '">';
            if (rest.length === 0) {
                html += '<div class="scell-empty">全员在岗</div>';
            } else {
                rest.forEach(function (n) {
                    var emp = EMPLOYEES.find(function (e) { return e.name === n; });
                    html += '<div class="scell-person rest" data-name="' + n + '" data-date="' + d + '">😴 ' + n + '<small>(' + SHIFT_CN[emp.shift] + ')</small></div>';
                });
            }
            html += '</td>';
        });
        html += '</tr></tbody></table>';

        $('tableArea').innerHTML = html;
        bindTableClicks();
    }

    /* ========== 点击切换 ========== */
    function bindTableClicks() {
        $('tableArea').querySelectorAll('[data-name][data-date]').forEach(function (el) {
            el.style.cursor = 'pointer';
            el.addEventListener('click', function (e) {
                e.stopPropagation();
                var name = this.dataset.name;
                var date = this.dataset.date;
                toggleDay(name, date);
            });
        });
    }

    function toggleDay(name, date) {
        if (!state.scheduler) return;
        var isRest = state.result.schedule[date].rest.indexOf(name) >= 0;
        state.scheduler.updateDay(date, name, isRest ? 'work' : 'rest');
        state.result.analysis = state.scheduler.analyze();
        renderAll();

        var action = isRest ? '上班' : '休息';
        var p = state.result.analysis.persons[name];
        toast(name + ' ' + date.slice(5) + ' → ' + action + '  |  本周：' + p.restEmoji + p.restText);
    }

    /* ========== 预警 ========== */
    function renderWarnings() {
        var w = state.result.analysis.warnings;
        var el = $('warnings');
        if (w.length === 0) { el.style.display = 'none'; return; }
        el.style.display = 'block';
        el.innerHTML = '<div class="warn-icon">⚠️</div><div class="warn-list">' +
            w.map(function (x) { return '<div>' + x + '</div>'; }).join('') + '</div>';
    }

    /* ========== 分析面板 ========== */
    function renderAnalysis() {
        var a = state.result.analysis;
        renderRestSummary(a);
        renderSuggestions(a);
        renderDetailTable(a);
    }

    function renderRestSummary(a) {
        var html = '';
        EMPLOYEES.forEach(function (emp) {
            var p = a.persons[emp.name];
            // 休息日显示
            var restDates = p.restDays.map(function (d) {
                var dt = new Date(d + 'T00:00:00');
                return (dt.getMonth() + 1) + '/' + dt.getDate() + '(周' + DAYS_CN[dt.getDay()] + ')';
            }).join('、');
            if (!restDates) restDates = '无';

            html += '<div class="rs-card ' + p.restType + '">';
            html += '<div class="rs-left">';
            html += '<span class="rs-name">' + emp.name + '</span>';
            html += '<span class="rs-shift ' + emp.shift + '">' + SHIFT_EMOJI[emp.shift] + SHIFT_CN[emp.shift] + '班</span>';
            html += '</div>';
            html += '<div class="rs-center">';
            html += '<span class="rs-rest-label ' + p.restType + '">' + p.restEmoji + ' ' + p.restText + '</span>';
            html += '<span class="rs-dates">休息日：' + restDates + '</span>';
            html += '</div>';
            html += '<div class="rs-right">';
            html += '<span class="rs-stat">工作' + p.workDays.length + '天</span>';
            html += '<span class="rs-stat">工时' + p.totalHours + 'h</span>';
            html += '<span class="rs-stat">连续最长' + p.maxConsecutive + '天</span>';
            if (p.weekendWork.length > 0) {
                html += '<span class="rs-stat weekend-duty">周末值班' + p.weekendWork.length + '天</span>';
            }
            html += '</div>';

            // 问题
            if (p.issues.length > 0) {
                html += '<div class="rs-issues">';
                p.issues.forEach(function (iss) {
                    html += '<span class="rs-issue ' + iss.lv + '">' + iss.msg + '</span>';
                });
                html += '</div>';
            }

            html += '</div>';
        });
        $('restSummary').innerHTML = html;
    }

    function renderSuggestions(a) {
        if (a.suggestions.length === 0) {
            $('suggestions').innerHTML = '';
            return;
        }
        var html = '<h3>💡 建议</h3>';
        a.suggestions.forEach(function (s) {
            html += '<div class="sug-item">' + s + '</div>';
        });
        $('suggestions').innerHTML = html;
    }

    function renderDetailTable(a) {
        var html = '<h3>📋 详细数据</h3>';
        html += '<table class="dtable"><thead><tr>';
        html += '<th>姓名</th><th>固定班次</th><th>工作天</th><th>休息天</th><th>总工时</th><th>周末值班</th><th>最长连续</th><th>状态</th>';
        html += '</tr></thead><tbody>';

        EMPLOYEES.forEach(function (emp) {
            var p = a.persons[emp.name];
            html += '<tr>';
            html += '<td><strong>' + emp.name + '</strong></td>';
            html += '<td>' + p.shiftLabel + '</td>';
            html += '<td>' + p.workDays.length + '</td>';
            html += '<td>' + p.restDays.length + '</td>';
            html += '<td>' + p.totalHours + 'h</td>';
            html += '<td>' + p.weekendWork.length + '</td>';
            html += '<td' + (p.maxConsecutive >= 6 ? ' class="danger-cell"' : '') + '>' + p.maxConsecutive + '</td>';
            html += '<td><span class="rest-label ' + p.restType + '">' + p.restEmoji + ' ' + p.restText + '</span></td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        $('detailTable').innerHTML = html;
    }

    /* ========== 导出 ========== */
    function exportCSV() {
        if (!state.result) { toast('请先生成排班'); return; }
        var r = state.result;
        var lines = [];
        var header = ['姓名', '固定班次'];
        r.dates.forEach(function (d) { header.push(r.meta[d].label + '(周' + r.meta[d].dayName + ')'); });
        header.push('工作天', '休息天', '状态');
        lines.push(header.join(','));

        EMPLOYEES.forEach(function (emp) {
            var p = r.analysis.persons[emp.name];
            var row = [emp.name, ShiftScheduler.SHIFTS[emp.shift].fullLabel];
            r.dates.forEach(function (d) {
                var isRest = r.schedule[d].rest.indexOf(emp.name) >= 0;
                row.push(isRest ? '休息' : SHIFT_CN[emp.shift] + '班');
            });
            row.push(p.workDays.length, p.restDays.length, p.restText);
            lines.push(row.join(','));
        });

        var csv = '\uFEFF' + lines.join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '排班表_' + r.dates[0] + '.csv';
        a.click();
        toast('已导出CSV');
    }

    function copyText() {
        if (!state.result) { toast('请先生成排班'); return; }
        var r = state.result;
        var lines = [];
        var weekTypeText = $('weekType').value === 'big' ? '【大休周/双休】' : '【小休周/单休】';
        lines.push('排班表 ' + r.dates[0] + '~' + r.dates[6] + ' ' + weekTypeText);
        lines.push('');

        EMPLOYEES.forEach(function (emp) {
            var p = r.analysis.persons[emp.name];
            var dayTexts = r.dates.map(function (d) {
                var m = r.meta[d];
                var isRest = r.schedule[d].rest.indexOf(emp.name) >= 0;
                return '周' + m.dayName + ':' + (isRest ? '休' : SHIFT_CN[emp.shift]);
            });
            lines.push(emp.name + '(' + SHIFT_CN[emp.shift] + '班) ' + dayTexts.join(' ') + '  ' + p.restEmoji + p.restText);
        });

        navigator.clipboard.writeText(lines.join('\n')).then(function () {
            toast('已复制到剪贴板');
        });
    }

    /* ========== 工具 ========== */
    function buildDates(ws) {
        var dates = [];
        var start = new Date(ws + 'T00:00:00');
        for (var i = 0; i < 7; i++) {
            var d = new Date(start);
            d.setDate(d.getDate() + i);
            dates.push({
                date: fmt(d),
                short: (d.getMonth() + 1) + '/' + d.getDate() + '(' + DAYS_CN[d.getDay()] + ')'
            });
        }
        return dates;
    }

    function fmt(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    function toast(msg) {
        var el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function () {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(function () { document.body.removeChild(el); }, 300);
        }, 2500);
    }

    init();
})();
