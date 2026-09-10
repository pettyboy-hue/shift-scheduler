/**
 * 排班助手前端交互 v3
 * 
 * 核心改变：
 * - 员工有固定班次，添加时必须选择
 * - 预置公司现有人员一键加载
 * - 特殊情况面板：调休假、请假
 * - 周视图 + 人员视图
 * - 点击单元格切换上班/休息，实时重新分析
 * - 分析面板：总览建议、休息详情、个人报告
 */

(function() {
    'use strict';

    // === 公司预置员工 ===
    var PRESET_EMPLOYEES = [
        { name: '罗凯',   shift: 'morning' },
        { name: '陈力',   shift: 'middle' },
        { name: '柳鹏',   shift: 'middle' },
        { name: '袁继春', shift: 'night' },
        { name: '罗浩文', shift: 'night' },
        { name: '陈阳倩', shift: 'night' },
        { name: '罗森鹏', shift: 'night' }
    ];

    var SHIFT_LABELS = { morning: '☀️ 早班', middle: '🌤️ 中班', night: '🌙 晚班' };
    var SHIFT_SHORT = { morning: '早', middle: '中', night: '晚' };
    var SHIFT_COLORS = {
        morning: { bg: '#fffbeb', text: '#d97706', border: '#fde68a' },
        middle:  { bg: '#eff6ff', text: '#2563eb', border: '#bfdbfe' },
        night:   { bg: '#f5f3ff', text: '#7c3aed', border: '#ddd6fe' },
        rest:    { bg: '#ecfdf5', text: '#059669', border: '#a7f3d0' }
    };
    var DAY_NAMES = ['日','一','二','三','四','五','六'];

    // === 状态 ===
    var state = {
        employees: [],      // [{ name, shift }]
        scheduler: null,
        result: null,       // { schedule, dates, dateMeta, analysis }
        currentView: 'week',
        specials: {}        // { name: { type, days } }
    };

    // === DOM 引用 ===
    var $ = function(id) { return document.getElementById(id); };

    // === 初始化 ===
    function init() {
        // 默认日期：本周一
        var today = new Date();
        var dow = today.getDay();
        var diff = dow === 0 ? -6 : 1 - dow;
        var monday = new Date(today);
        monday.setDate(today.getDate() + diff);
        $('input-week-start').value = formatDate(monday);

        // 加载本地存储
        loadState();
        renderEmployeeList();
        renderSpecialList();

        // 事件绑定
        $('btn-add-emp').addEventListener('click', addEmployee);
        $('input-emp-name').addEventListener('keypress', function(e) {
            if (e.key === 'Enter') addEmployee();
        });
        $('btn-load-preset').addEventListener('click', loadPreset);
        $('btn-generate').addEventListener('click', generateSchedule);
        $('btn-export').addEventListener('click', exportCSV);
        $('btn-view-week').addEventListener('click', function() { switchView('week'); });
        $('btn-view-person').addEventListener('click', function() { switchView('person'); });

        // 弹窗
        $('modal-close').addEventListener('click', closeModal);
        $('modal-cancel').addEventListener('click', closeModal);
        $('modal-edit').querySelector('.modal-backdrop').addEventListener('click', closeModal);
        $('modal-impact-close').addEventListener('click', closeImpactModal);
        $('modal-impact-ok').addEventListener('click', closeImpactModal);
        $('modal-impact').querySelector('.modal-backdrop').addEventListener('click', closeImpactModal);

        // 分析标签
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tab = this.getAttribute('data-tab');
                document.querySelectorAll('.tab-btn').forEach(function(b) {
                    b.classList.toggle('active', b.getAttribute('data-tab') === tab);
                });
                document.querySelectorAll('.tab-content').forEach(function(tc) {
                    tc.classList.toggle('active', tc.id === 'tab-' + tab);
                });
            });
        });
    }

    // === 员工管理 ===
    function addEmployee() {
        var name = $('input-emp-name').value.trim();
        var shift = $('select-emp-shift').value;
        if (!name) return;
        if (state.employees.some(function(e) { return e.name === name; })) {
            showToast('员工「' + name + '」已存在');
            return;
        }
        state.employees.push({ name: name, shift: shift });
        $('input-emp-name').value = '';
        renderEmployeeList();
        renderSpecialList();
        saveState();
    }

    function removeEmployee(name) {
        state.employees = state.employees.filter(function(e) { return e.name !== name; });
        delete state.specials[name];
        renderEmployeeList();
        renderSpecialList();
        saveState();
    }

    function loadPreset() {
        state.employees = PRESET_EMPLOYEES.map(function(e) { return { name: e.name, shift: e.shift }; });
        state.specials = {};
        renderEmployeeList();
        renderSpecialList();
        saveState();
        showToast('已加载公司现有 ' + PRESET_EMPLOYEES.length + ' 名员工');
    }

    function renderEmployeeList() {
        var el = $('employee-list');
        if (state.employees.length === 0) {
            el.innerHTML = '<p class="empty-hint">还没有员工，点击下方按钮加载</p>';
            return;
        }

        // 按班次分组显示
        var groups = { morning: [], middle: [], night: [] };
        state.employees.forEach(function(emp) {
            groups[emp.shift].push(emp);
        });

        var html = '';
        ['morning', 'middle', 'night'].forEach(function(shift) {
            var emps = groups[shift];
            if (emps.length === 0) return;
            var conf = ShiftScheduler.SHIFT_CONFIG[shift];
            html += '<div class="emp-group">';
            html += '<div class="emp-group-title">' + SHIFT_LABELS[shift] + ' <small>' + conf.time + '</small> <span class="emp-count">' + emps.length + '人</span></div>';
            emps.forEach(function(emp) {
                html += '<div class="emp-tag ' + shift + '">';
                html += '<span class="emp-name">' + emp.name + '</span>';
                html += '<button class="emp-remove" data-name="' + emp.name + '">&times;</button>';
                html += '</div>';
            });
            html += '</div>';
        });

        el.innerHTML = html;
        el.querySelectorAll('.emp-remove').forEach(function(btn) {
            btn.addEventListener('click', function(e) {
                e.stopPropagation();
                removeEmployee(this.getAttribute('data-name'));
            });
        });
    }

    // === 特殊情况面板 ===
    function renderSpecialList() {
        var el = $('special-list');
        if (state.employees.length === 0) {
            el.innerHTML = '<p class="empty-hint">添加员工后这里会显示调休/请假选项</p>';
            return;
        }

        var weekStart = $('input-week-start').value;
        if (!weekStart) {
            el.innerHTML = '<p class="empty-hint">请先选择起始日期</p>';
            return;
        }

        // 生成本周日期选项
        var weekDates = [];
        var start = new Date(weekStart + 'T00:00:00');
        for (var i = 0; i < 7; i++) {
            var d = new Date(start);
            d.setDate(d.getDate() + i);
            weekDates.push({
                date: formatDate(d),
                label: (d.getMonth()+1) + '/' + d.getDate() + '(' + DAY_NAMES[d.getDay()] + ')'
            });
        }

        var html = '';
        state.employees.forEach(function(emp) {
            var sp = state.specials[emp.name];
            var hasSpecial = sp && sp.days && sp.days.length > 0;
            
            html += '<div class="special-row">';
            html += '<div class="special-name">' + emp.name + ' <small class="special-shift">' + SHIFT_SHORT[emp.shift] + '班</small></div>';
            html += '<div class="special-controls">';
            html += '<select class="special-type" data-name="' + emp.name + '">';
            html += '<option value="none"' + (!hasSpecial ? ' selected' : '') + '>正常上班</option>';
            html += '<option value="dayoff"' + (sp && sp.type === 'dayoff' ? ' selected' : '') + '>🏖️ 调休</option>';
            html += '<option value="leave"' + (sp && sp.type === 'leave' ? ' selected' : '') + '>📝 请假</option>';
            html += '</select>';
            
            // 日期选择（多选）
            html += '<div class="special-dates" data-name="' + emp.name + '"' + (!hasSpecial && (!sp || sp.type === 'none') ? ' style="display:none"' : '') + '>';
            weekDates.forEach(function(wd) {
                var checked = sp && sp.days && sp.days.indexOf(wd.date) >= 0 ? ' checked' : '';
                html += '<label class="date-check"><input type="checkbox" value="' + wd.date + '"' + checked + ' data-emp="' + emp.name + '"/>' + wd.label + '</label>';
            });
            html += '</div>';
            
            html += '</div></div>';
        });

        el.innerHTML = html;

        // 绑定类型切换
        el.querySelectorAll('.special-type').forEach(function(sel) {
            sel.addEventListener('change', function() {
                var name = this.getAttribute('data-name');
                var type = this.value;
                var datesDiv = el.querySelector('.special-dates[data-name="' + name + '"]');
                
                if (type === 'none') {
                    delete state.specials[name];
                    datesDiv.style.display = 'none';
                } else {
                    if (!state.specials[name]) state.specials[name] = { type: type, days: [] };
                    state.specials[name].type = type;
                    datesDiv.style.display = 'flex';
                }
                saveState();
            });
        });

        // 绑定日期勾选
        el.querySelectorAll('.date-check input').forEach(function(cb) {
            cb.addEventListener('change', function() {
                var name = this.getAttribute('data-emp');
                var date = this.value;
                if (!state.specials[name]) state.specials[name] = { type: 'dayoff', days: [] };
                if (this.checked) {
                    if (state.specials[name].days.indexOf(date) < 0) {
                        state.specials[name].days.push(date);
                    }
                } else {
                    state.specials[name].days = state.specials[name].days.filter(function(d) { return d !== date; });
                }
                saveState();
            });
        });
    }

    // 日期变化时刷新特殊情况面板
    $('input-week-start').addEventListener('change', function() {
        renderSpecialList();
    });

    // === 生成排班 ===
    function generateSchedule() {
        if (state.employees.length === 0) {
            showToast('请先添加员工');
            return;
        }
        var weekStart = $('input-week-start').value;
        if (!weekStart) {
            showToast('请选择起始日期');
            return;
        }

        var scheduler = new ShiftScheduler({
            employees: state.employees.slice(),
            weekStart: weekStart,
            weekType: $('select-week-type').value,
            busyness: $('select-busyness').value,
            specials: JSON.parse(JSON.stringify(state.specials)),
            history: loadHistory()
        });

        state.scheduler = scheduler;
        state.result = scheduler.generate();

        renderSchedule();
        renderAnalysis();
        saveState();
        showToast('排班生成成功！' + state.result.analysis.summary.weekType);
    }

    // === 渲染排班表 ===
    function renderSchedule() {
        if (!state.result) return;
        $('schedule-title').textContent = '📋 排班表 — ' + state.result.analysis.summary.dateRange + ' ' + state.result.analysis.summary.weekType;
        
        if (state.currentView === 'week') {
            renderWeekView();
        } else {
            renderPersonView();
        }
    }

    // 周视图：7列，每列一天
    function renderWeekView() {
        var r = state.result;
        var html = '<table class="week-table"><thead><tr>';
        
        r.dates.forEach(function(dateStr) {
            var meta = r.dateMeta[dateStr];
            var cls = meta.isWeekend ? ' weekend' : '';
            var restTag = meta.isRestDay ? '<span class="rest-tag">休息日</span>' : '';
            html += '<th class="' + cls + '">';
            html += '<div class="th-date">' + dateStr.slice(5) + '</div>';
            html += '<div class="th-day">周' + meta.dayName + '</div>';
            html += restTag;
            html += '</th>';
        });
        html += '</tr></thead><tbody>';

        // 每个班次一行
        ['morning', 'middle', 'night'].forEach(function(shift) {
            var conf = ShiftScheduler.SHIFT_CONFIG[shift];
            var color = SHIFT_COLORS[shift];
            html += '<tr class="shift-row">';
            
            r.dates.forEach(function(dateStr, idx) {
                var daySched = r.schedule[dateStr];
                var meta = r.dateMeta[dateStr];
                var people = daySched[shift] || [];
                var cellCls = meta.isWeekend ? ' weekend-cell' : '';
                
                html += '<td class="shift-cell' + cellCls + '" data-date="' + dateStr + '">';
                if (idx === 0) {
                    html += '<div class="shift-label" style="background:' + color.bg + ';color:' + color.text + ';border:1px solid ' + color.border + '">';
                    html += SHIFT_LABELS[shift] + ' <small>' + conf.time + '</small>';
                    html += '</div>';
                }
                
                if (people.length === 0) {
                    html += '<div class="cell-empty">—</div>';
                } else {
                    people.forEach(function(name) {
                        html += '<div class="cell-person ' + shift + '" data-name="' + name + '" data-date="' + dateStr + '">';
                        html += name;
                        html += '</div>';
                    });
                }
                html += '</td>';
            });
            html += '</tr>';
        });

        // 休息行
        html += '<tr class="rest-row">';
        r.dates.forEach(function(dateStr) {
            var daySched = r.schedule[dateStr];
            var meta = r.dateMeta[dateStr];
            var cellCls = meta.isWeekend ? ' weekend-cell' : '';
            var restPeople = daySched.rest || [];
            
            html += '<td class="shift-cell rest-cell' + cellCls + '">';
            if (restPeople.length === 0) {
                html += '<div class="cell-empty">全员在岗</div>';
            } else {
                restPeople.forEach(function(name) {
                    var emp = state.employees.find(function(e) { return e.name === name; });
                    var shiftKey = emp ? emp.shift : 'rest';
                    html += '<div class="cell-person rest" data-name="' + name + '" data-date="' + dateStr + '">';
                    html += '😴 ' + name + ' <small>(' + SHIFT_SHORT[shiftKey] + ')</small>';
                    html += '</div>';
                });
            }
            html += '</td>';
        });
        html += '</tr>';

        html += '</tbody></table>';
        $('schedule-container').innerHTML = html;

        // 点击人名切换上班/休息
        $('schedule-container').querySelectorAll('.cell-person').forEach(function(el) {
            el.addEventListener('click', function(e) {
                e.stopPropagation();
                var name = this.getAttribute('data-name');
                var dateStr = this.getAttribute('data-date');
                togglePersonDay(name, dateStr);
            });
        });

        // 点击单元格打开编辑弹窗
        $('schedule-container').querySelectorAll('.shift-cell').forEach(function(cell) {
            cell.addEventListener('click', function() {
                var dateStr = this.getAttribute('data-date');
                if (dateStr) openEditModal(dateStr);
            });
        });
    }

    // 人员视图：每人一行
    function renderPersonView() {
        var r = state.result;
        var analysis = r.analysis;
        
        var html = '<table class="person-table"><thead><tr>';
        html += '<th class="name-col">员工</th>';
        html += '<th class="shift-col">班次</th>';
        r.dates.forEach(function(dateStr) {
            var meta = r.dateMeta[dateStr];
            var cls = meta.isWeekend ? ' weekend' : '';
            html += '<th class="' + cls + '">' + dateStr.slice(8) + '<br><small>周' + meta.dayName + '</small></th>';
        });
        html += '<th>本周状态</th>';
        html += '</tr></thead><tbody>';

        state.employees.forEach(function(emp) {
            var personData = analysis.perPerson[emp.name];
            var color = SHIFT_COLORS[emp.shift];
            
            html += '<tr>';
            html += '<td class="name-cell">' + emp.name + '</td>';
            html += '<td><span class="mini-shift-badge" style="background:' + color.bg + ';color:' + color.text + '">' + SHIFT_SHORT[emp.shift] + '</span></td>';
            
            r.dates.forEach(function(dateStr) {
                var daySched = r.schedule[dateStr];
                var meta = r.dateMeta[dateStr];
                var isResting = daySched.rest.indexOf(emp.name) >= 0;
                var cellCls = meta.isWeekend ? ' weekend-cell' : '';
                
                html += '<td class="day-cell' + cellCls + '" data-name="' + emp.name + '" data-date="' + dateStr + '">';
                if (isResting) {
                    html += '<span class="day-badge rest">休</span>';
                } else {
                    html += '<span class="day-badge ' + emp.shift + '">' + SHIFT_SHORT[emp.shift] + '</span>';
                }
                html += '</td>';
            });

            // 本周状态标签
            html += '<td>';
            if (personData) {
                var labelColor = personData.restType === 'double' ? '#059669' :
                                 personData.restType === 'single' ? '#d97706' :
                                 personData.restType === 'split' ? '#ea580c' : '#dc2626';
                html += '<span class="status-badge" style="color:' + labelColor + '">' + personData.restLabel + '</span>';
                if (personData.issues.length > 0) {
                    var worst = personData.issues.some(function(i) { return i.level === 'danger'; });
                    html += '<span class="issue-dot ' + (worst ? 'danger' : 'warning') + '">' + personData.issues.length + '</span>';
                }
            }
            html += '</td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        $('schedule-container').innerHTML = html;

        // 点击切换
        $('schedule-container').querySelectorAll('.day-cell').forEach(function(cell) {
            cell.addEventListener('click', function() {
                var name = this.getAttribute('data-name');
                var dateStr = this.getAttribute('data-date');
                togglePersonDay(name, dateStr);
            });
        });
    }

    // 切换某人某天的上班/休息状态
    function togglePersonDay(name, dateStr) {
        if (!state.scheduler) return;
        var daySched = state.result.schedule[dateStr];
        var isResting = daySched.rest.indexOf(name) >= 0;

        // 保存旧分析
        var oldAnalysis = state.result.analysis;

        // 切换状态
        state.scheduler.updateDay(dateStr, name, isResting ? 'work' : 'rest');
        
        // 重新分析
        state.result.analysis = state.scheduler.reAnalyze();
        
        renderSchedule();
        renderAnalysis();

        // 显示影响
        showImpact(name, dateStr, isResting ? '休息→上班' : '上班→休息', oldAnalysis);
    }

    // === 编辑弹窗 ===
    function openEditModal(dateStr) {
        if (!state.result) return;
        var meta = state.result.dateMeta[dateStr];
        var daySched = state.result.schedule[dateStr];

        $('modal-title').textContent = dateStr + '（周' + meta.dayName + '）编辑';

        var html = '<div class="edit-hint">💡 点击「上班/休息」切换状态，保存后自动重新分析</div>';
        
        state.employees.forEach(function(emp) {
            var isResting = daySched.rest.indexOf(emp.name) >= 0;
            var personData = state.result.analysis.perPerson[emp.name];
            var issueCount = personData ? personData.issues.length : 0;
            var issueTag = issueCount > 0 ? '<span class="edit-issue-count">' + issueCount + '⚠</span>' : '';
            
            html += '<div class="edit-row">';
            html += '<span class="edit-name">' + emp.name + ' <small class="edit-shift">' + SHIFT_LABELS[emp.shift] + '</small>' + issueTag + '</span>';
            html += '<select class="edit-select" data-name="' + emp.name + '">';
            html += '<option value="work"' + (!isResting ? ' selected' : '') + '>🔵 上班（' + ShiftScheduler.SHIFT_CONFIG[emp.shift].time + '）</option>';
            html += '<option value="rest"' + (isResting ? ' selected' : '') + '>😴 休息</option>';
            html += '</select>';
            html += '</div>';
        });

        $('modal-body').innerHTML = html;
        $('modal-edit').style.display = 'flex';

        $('modal-save').onclick = function() {
            var oldAnalysis = state.result.analysis;

            $('modal-body').querySelectorAll('.edit-select').forEach(function(sel) {
                var name = sel.getAttribute('data-name');
                state.scheduler.updateDay(dateStr, name, sel.value);
            });

            state.result.analysis = state.scheduler.reAnalyze();
            closeModal();
            renderSchedule();
            renderAnalysis();
            showImpactFull(dateStr, oldAnalysis);
        };
    }

    function closeModal() { $('modal-edit').style.display = 'none'; }
    function closeImpactModal() { $('modal-impact').style.display = 'none'; }

    // === 影响提示（简单版，点击切换时） ===
    function showImpact(name, dateStr, action, oldAnalysis) {
        var newData = state.result.analysis.perPerson[name];
        var oldData = oldAnalysis.perPerson[name];
        if (!newData || !oldData) return;

        var msg = name + ' ' + dateStr.slice(5) + ' ' + action;
        if (newData.restLabel !== oldData.restLabel) {
            msg += ' → 本周变为' + newData.restLabel;
        }
        showToast(msg);
    }

    // === 影响分析弹窗（完整版，编辑弹窗保存时） ===
    function showImpactFull(dateStr, oldAnalysis) {
        var newAnalysis = state.result.analysis;
        var changes = [];

        state.employees.forEach(function(emp) {
            var oldD = oldAnalysis.perPerson[emp.name];
            var newD = newAnalysis.perPerson[emp.name];
            if (!oldD || !newD) return;

            var diff = {
                name: emp.name,
                restChanged: newD.restLabel !== oldD.restLabel,
                oldRestLabel: oldD.restLabel,
                newRestLabel: newD.restLabel,
                workDiff: newD.workDays.length - oldD.workDays.length,
                newIssues: [],
                resolvedIssues: []
            };

            newD.issues.forEach(function(ni) {
                var existed = oldD.issues.some(function(oi) { return oi.text === ni.text; });
                if (!existed) diff.newIssues.push(ni);
            });
            oldD.issues.forEach(function(oi) {
                var still = newD.issues.some(function(ni) { return ni.text === oi.text; });
                if (!still) diff.resolvedIssues.push(oi);
            });

            if (diff.restChanged || diff.newIssues.length > 0 || diff.resolvedIssues.length > 0) {
                changes.push(diff);
            }
        });

        if (changes.length === 0) {
            showToast('已更新 ' + dateStr + ' 排班');
            return;
        }

        var html = '<div class="impact-date">📅 调整日期：' + dateStr + '</div>';
        html += '<div class="impact-list">';

        changes.forEach(function(c) {
            html += '<div class="impact-person">';
            html += '<div class="impact-name">' + c.name + '</div>';
            
            if (c.restChanged) {
                html += '<div class="impact-rest-change">' + c.oldRestLabel + ' → ' + c.newRestLabel + '</div>';
            }
            if (c.workDiff !== 0) {
                var icon = c.workDiff > 0 ? '📈' : '📉';
                html += '<div class="impact-work">' + icon + ' 工作天数 ' + (c.workDiff > 0 ? '+' : '') + c.workDiff + '天</div>';
            }
            c.newIssues.forEach(function(issue) {
                html += '<div class="impact-issue new">⚠️ 新增：' + issue.text + '</div>';
            });
            c.resolvedIssues.forEach(function(issue) {
                html += '<div class="impact-issue resolved">✅ 已解决：' + issue.text + '</div>';
            });
            html += '</div>';
        });

        html += '</div>';
        $('modal-impact-body').innerHTML = html;
        $('modal-impact').style.display = 'flex';
    }

    // === 分析面板渲染 ===
    function renderAnalysis() {
        if (!state.result) return;
        $('analysis-panel').style.display = 'block';
        var analysis = state.result.analysis;

        renderWarnings(analysis);
        renderOverview(analysis);
        renderWeeklyDetail(analysis);
        renderPersonReports(analysis);
    }

    function renderWarnings(analysis) {
        var el = $('warning-banner');
        if (analysis.warnings.length === 0) {
            el.style.display = 'none';
            return;
        }
        var html = '<div class="warning-icon">⚠️</div><div class="warning-list">';
        analysis.warnings.forEach(function(w) {
            html += '<div class="warning-item">' + w + '</div>';
        });
        html += '</div>';
        el.innerHTML = html;
        el.style.display = 'flex';
    }

    function renderOverview(analysis) {
        var html = '';
        
        // 概要
        var s = analysis.summary;
        html += '<div class="overview-summary">';
        html += '<div class="summary-item">👥 ' + s.totalEmployees + '人</div>';
        html += '<div class="summary-item">📅 ' + s.weekType + '</div>';
        html += '<div class="summary-item">📊 ' + s.busyness + '</div>';
        html += '<div class="summary-item">🗓️ ' + s.dateRange + '</div>';
        html += '</div>';

        // 建议
        html += '<div class="suggestions">';
        html += '<h3>💡 智能建议</h3>';
        analysis.suggestions.forEach(function(sug) {
            html += '<div class="suggestion-item"><span class="sug-icon">' + sug.icon + '</span><span>' + sug.text + '</span></div>';
        });
        html += '</div>';

        // 快速概览：每人休息类型一览
        html += '<div class="rest-overview">';
        html += '<h3>😴 本周休息一览</h3>';
        html += '<div class="rest-tags">';
        state.employees.forEach(function(emp) {
            var d = analysis.perPerson[emp.name];
            if (!d) return;
            var labelColor = d.restType === 'double' ? '#059669' :
                             d.restType === 'single' ? '#d97706' :
                             d.restType === 'split' ? '#ea580c' : '#dc2626';
            html += '<div class="rest-tag-item">';
            html += '<span class="rest-tag-name">' + emp.name + '</span>';
            html += '<span class="rest-tag-label" style="color:' + labelColor + '">' + d.restLabel + '</span>';
            if (d.restDays.length > 0) {
                var dates = d.restDays.map(function(dd) { return dd.slice(8) + '(' + DAY_NAMES[new Date(dd).getDay()] + ')'; });
                html += '<span class="rest-tag-dates">' + dates.join(' ') + '</span>';
            }
            html += '</div>';
        });
        html += '</div></div>';

        $('tab-overview').innerHTML = html;
    }

    function renderWeeklyDetail(analysis) {
        var html = '<table class="detail-table"><thead><tr>';
        html += '<th>员工</th><th>固定班次</th><th>工作天数</th><th>休息天数</th><th>总工时</th><th>周末值班</th><th>最长连续工作</th><th>本周状态</th>';
        html += '</tr></thead><tbody>';

        state.employees.forEach(function(emp) {
            var d = analysis.perPerson[emp.name];
            if (!d) return;
            var labelColor = d.restType === 'double' ? '#059669' :
                             d.restType === 'single' ? '#d97706' :
                             d.restType === 'split' ? '#ea580c' : '#dc2626';

            html += '<tr>';
            html += '<td><strong>' + emp.name + '</strong></td>';
            html += '<td>' + d.fixedShiftLabel + ' ' + d.fixedShiftTime + '</td>';
            html += '<td>' + d.workDays.length + '天</td>';
            html += '<td>' + d.restDays.length + '天</td>';
            html += '<td>' + d.totalHours + 'h</td>';
            html += '<td>' + d.weekendDutyDays.length + '天</td>';
            html += '<td' + (d.consecutiveWork >= 5 ? ' class="cell-warn"' : '') + '>' + d.consecutiveWork + '天</td>';
            html += '<td><span style="color:' + labelColor + ';font-weight:600">' + d.restLabel + '</span></td>';
            html += '</tr>';
        });

        html += '</tbody></table>';
        $('tab-weekly').innerHTML = html;
    }

    function renderPersonReports(analysis) {
        var html = '';
        state.employees.forEach(function(emp) {
            var d = analysis.perPerson[emp.name];
            if (!d) return;
            var color = SHIFT_COLORS[emp.shift];

            html += '<div class="person-report">';
            html += '<div class="pr-header" style="border-left: 4px solid ' + color.text + '">';
            html += '<div class="pr-name">' + emp.name + '</div>';
            html += '<div class="pr-shift" style="background:' + color.bg + ';color:' + color.text + '">' + d.fixedShiftLabel + ' ' + d.fixedShiftTime + '</div>';
            html += '</div>';

            html += '<div class="pr-stats">';
            html += '<div class="pr-stat"><span class="ps-label">工作</span><span class="ps-value">' + d.workDays.length + '天</span></div>';
            html += '<div class="pr-stat"><span class="ps-label">休息</span><span class="ps-value">' + d.restDays.length + '天</span></div>';
            html += '<div class="pr-stat"><span class="ps-label">工时</span><span class="ps-value">' + d.totalHours + 'h</span></div>';
            html += '<div class="pr-stat"><span class="ps-label">周末值班</span><span class="ps-value">' + d.weekendDutyDays.length + '天</span></div>';
            html += '<div class="pr-stat"><span class="ps-label">连续工作</span><span class="ps-value">' + d.consecutiveWork + '天</span></div>';
            html += '<div class="pr-stat"><span class="ps-label">状态</span><span class="ps-value">' + d.restLabel + '</span></div>';
            html += '</div>';

            // 问题
            if (d.issues.length > 0) {
                html += '<div class="pr-issues">';
                d.issues.forEach(function(issue) {
                    var cls = issue.level === 'danger' ? 'issue-danger' : issue.level === 'warning' ? 'issue-warning' : 'issue-info';
                    html += '<div class="pr-issue ' + cls + '">' + issue.text + '</div>';
                });
                html += '</div>';
            } else {
                html += '<div class="pr-issues"><div class="pr-issue issue-ok">✅ 排班合理</div></div>';
            }

            // 每日详情
            html += '<div class="pr-days">';
            state.result.dates.forEach(function(dateStr) {
                var meta = state.result.dateMeta[dateStr];
                var isResting = state.result.schedule[dateStr].rest.indexOf(emp.name) >= 0;
                html += '<div class="pr-day ' + (isResting ? 'rest' : emp.shift) + '">';
                html += '<div class="prd-date">' + dateStr.slice(8) + '</div>';
                html += '<div class="prd-day">周' + meta.dayName + '</div>';
                html += '<div class="prd-status">' + (isResting ? '休' : SHIFT_SHORT[emp.shift]) + '</div>';
                html += '</div>';
            });
            html += '</div>';

            html += '</div>';
        });

        $('tab-person').innerHTML = html;
    }

    // === 视图切换 ===
    function switchView(view) {
        state.currentView = view;
        $('btn-view-week').classList.toggle('active', view === 'week');
        $('btn-view-person').classList.toggle('active', view === 'person');
        renderSchedule();
    }

    // === 导出 CSV ===
    function exportCSV() {
        if (!state.result) { showToast('请先生成排班'); return; }
        var r = state.result;
        var lines = [];
        var header = ['员工', '班次'];
        r.dates.forEach(function(d) {
            var meta = r.dateMeta[d];
            header.push(d.slice(5) + '(周' + meta.dayName + ')');
        });
        header.push('工作天数', '休息天数', '状态');
        lines.push(header.join(','));

        state.employees.forEach(function(emp) {
            var row = [emp.name, ShiftScheduler.SHIFT_CONFIG[emp.shift].label];
            var personData = r.analysis.perPerson[emp.name];
            r.dates.forEach(function(dateStr) {
                var isResting = r.schedule[dateStr].rest.indexOf(emp.name) >= 0;
                row.push(isResting ? '休息' : ShiftScheduler.SHIFT_CONFIG[emp.shift].label);
            });
            row.push(personData.workDays.length, personData.restDays.length, personData.restLabel.replace(/[^\u4e00-\u9fa5\d]/g, ''));
            lines.push(row.join(','));
        });

        var csv = '\uFEFF' + lines.join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '排班表_' + state.result.dates[0] + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        showToast('已导出CSV');
    }

    // === 本地存储 ===
    function saveState() {
        try {
            localStorage.setItem('ss-employees', JSON.stringify(state.employees));
            localStorage.setItem('ss-specials', JSON.stringify(state.specials));
        } catch(e) {}
    }

    function loadState() {
        try {
            var emps = localStorage.getItem('ss-employees');
            if (emps) state.employees = JSON.parse(emps);
            var sp = localStorage.getItem('ss-specials');
            if (sp) state.specials = JSON.parse(sp);
        } catch(e) {}
    }

    function loadHistory() {
        try {
            var h = localStorage.getItem('ss-history');
            return h ? JSON.parse(h) : {};
        } catch(e) { return {}; }
    }

    // === 工具 ===
    function formatDate(d) {
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, '0');
        var day = String(d.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + day;
    }

    function showToast(msg) {
        var el = document.createElement('div');
        el.className = 'toast';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(function() {
            el.style.opacity = '0';
            el.style.transition = 'opacity 0.3s';
            setTimeout(function() { document.body.removeChild(el); }, 300);
        }, 2500);
    }

    init();
})();
