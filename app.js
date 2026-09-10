/**
 * 排班系统前端交互（v2 - 含健康分析）
 * 
 * 新增功能：
 * - 实时健康分析：生成/手动调整后自动运行分析器
 * - 预警横幅：危险问题自动置顶提醒
 * - 幸福指数排名：每人一个分数+进度条
 * - 每周休息详情表：双休/单休/连休/无休 一目了然
 * - 公平性仪表盘：工时/休天/周末值班 对比图
 * - 个人详细报告：问题列表+建议
 * - 调整影响弹窗：修改后对比谁失去/获得了休息
 */

(function() {
    'use strict';

    // === 状态 ===
    var state = {
        employees: [],
        scheduler: null,
        schedule: null,
        analysisResult: null,
        snapshotBeforeEdit: null, // 编辑前快照，用于对比
        currentView: 'calendar'
    };

    var COLORS = [
        '#4f46e5','#059669','#d97706','#dc2626','#7c3aed',
        '#0891b2','#be185d','#65a30d','#ea580c','#6366f1',
        '#0d9488','#ca8a04','#e11d48','#8b5cf6','#2563eb'
    ];

    var SHIFT_LABELS = { morning: '早', middle: '中', night: '晚', rest: '休' };
    var SHIFT_NAMES = { morning: '早班', middle: '中班', night: '晚班', rest: '休息' };
    var DAY_NAMES = ['日','一','二','三','四','五','六'];

    // === DOM 缓存 ===
    var $ = function(id) { return document.getElementById(id); };
    var $inputEmployee = $('input-employee');
    var $btnAddEmployee = $('btn-add-employee');
    var $employeeList = $('employee-list');
    var $btnDemoEmployees = $('btn-demo-employees');
    var $inputMonth = $('input-month');
    var $selectFirstWeek = $('select-first-week');
    var $inputWeekdayCount = $('input-weekday-count');
    var $inputWeekendCount = $('input-weekend-count');
    var $checkNightShift = $('check-night-shift');
    var $btnGenerate = $('btn-generate');
    var $btnExport = $('btn-export');
    var $btnSave = $('btn-save');
    var $btnViewCalendar = $('btn-view-calendar');
    var $btnViewList = $('btn-view-list');
    var $scheduleContainer = $('schedule-container');
    var $statsPanel = $('stats-panel');
    var $statsGrid = $('stats-grid');
    var $modal = $('modal-edit');
    var $modalTitle = $('modal-title');
    var $modalBody = $('modal-body');
    var $modalClose = $('modal-close');
    var $modalCancel = $('modal-cancel');
    var $modalSave = $('modal-save');
    // 新增DOM
    var $warningBanner = $('warning-banner');
    var $analysisPanel = $('analysis-panel');
    var $suggestionsArea = $('suggestions-area');
    var $happinessRanking = $('happiness-ranking');
    var $weeklyRestGrid = $('weekly-rest-grid');
    var $fairnessDashboard = $('fairness-dashboard');
    var $employeeReports = $('employee-reports');
    var $modalImpact = $('modal-impact');
    var $modalImpactBody = $('modal-impact-body');
    var $modalImpactClose = $('modal-impact-close');
    var $modalImpactOk = $('modal-impact-ok');

    // === 初始化 ===
    function init() {
        var now = new Date();
        var y = now.getFullYear();
        var m = String(now.getMonth() + 1);
        if (m.length < 2) m = '0' + m;
        $inputMonth.value = y + '-' + m;

        loadState();
        renderEmployeeList();

        // 事件绑定
        $btnAddEmployee.addEventListener('click', addEmployee);
        $inputEmployee.addEventListener('keypress', function(e) {
            if (e.key === 'Enter') addEmployee();
        });
        $btnDemoEmployees.addEventListener('click', loadDemoEmployees);
        $btnGenerate.addEventListener('click', generateSchedule);
        $btnExport.addEventListener('click', exportSchedule);
        $btnSave.addEventListener('click', saveState);
        $btnViewCalendar.addEventListener('click', function() { switchView('calendar'); });
        $btnViewList.addEventListener('click', function() { switchView('list'); });
        $modalClose.addEventListener('click', closeModal);
        $modalCancel.addEventListener('click', closeModal);
        $modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);

        // 影响弹窗关闭
        $modalImpactClose.addEventListener('click', closeImpactModal);
        $modalImpactOk.addEventListener('click', closeImpactModal);
        $modalImpact.querySelector('.modal-backdrop').addEventListener('click', closeImpactModal);

        // 分析面板标签切换
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.addEventListener('click', function() {
                var tab = this.getAttribute('data-tab');
                switchAnalysisTab(tab);
            });
        });
    }

    // === 员工管理 ===
    function addEmployee() {
        var name = $inputEmployee.value.trim();
        if (!name) return;
        if (state.employees.indexOf(name) >= 0) {
            showToast('员工「' + name + '」已存在');
            return;
        }
        state.employees.push(name);
        $inputEmployee.value = '';
        renderEmployeeList();
        saveState();
    }

    function removeEmployee(name) {
        var idx = state.employees.indexOf(name);
        if (idx >= 0) {
            state.employees.splice(idx, 1);
            renderEmployeeList();
            saveState();
        }
    }

    function loadDemoEmployees() {
        var demo = ['张伟','李娜','王磊','刘洋','陈静','赵鹏','孙婷','周杰','吴敏','郑强','黄丽','林涛'];
        state.employees = demo.slice();
        renderEmployeeList();
        saveState();
        showToast('已加载 ' + demo.length + ' 名示例员工');
    }

    function renderEmployeeList() {
        if (state.employees.length === 0) {
            $employeeList.innerHTML = '<p class="empty-hint">还没有员工，请添加</p>';
            return;
        }
        var html = '';
        state.employees.forEach(function(name, i) {
            var color = COLORS[i % COLORS.length];
            var initial = name.charAt(0);
            html += '<div class="employee-tag">' +
                '<span class="name">' +
                    '<span class="avatar" style="background:' + color + '">' + initial + '</span>' +
                    name +
                '</span>' +
                '<button class="remove" data-name="' + name + '" title="移除">&times;</button>' +
            '</div>';
        });
        $employeeList.innerHTML = html;
        $employeeList.querySelectorAll('.remove').forEach(function(btn) {
            btn.addEventListener('click', function() {
                removeEmployee(this.getAttribute('data-name'));
            });
        });
    }

    // === 生成排班 ===
    function generateSchedule() {
        if (state.employees.length === 0) {
            showToast('请先添加员工');
            return;
        }

        var monthVal = $inputMonth.value;
        if (!monthVal) {
            showToast('请选择排班月份');
            return;
        }

        var parts = monthVal.split('-');
        var year = parseInt(parts[0]);
        var month = parseInt(parts[1]);
        var enableNight = $checkNightShift.checked;

        try {
            var scheduler = new ShiftScheduler({
                employees: state.employees.slice(),
                year: year,
                month: month,
                firstWeekType: $selectFirstWeek.value,
                weekdayPerShift: parseInt($inputWeekdayCount.value) || 2,
                weekendPerShift: parseInt($inputWeekendCount.value) || 1,
                enableNightShift: enableNight
            });

            scheduler.generate();
            state.scheduler = scheduler;
            state.schedule = scheduler.schedule;

            renderSchedule();
            renderStats();
            runAnalysis(); // 生成后立即分析
            saveState();
            showToast('排班生成成功！共 ' + Object.keys(state.schedule).length + ' 天');
        } catch (e) {
            showToast(e.message);
        }
    }

    // ===== 核心新功能：运行分析 =====
    function runAnalysis() {
        if (!state.scheduler || !state.schedule) return;

        var dateMeta = state.scheduler.getDateMeta();
        var shifts = state.scheduler.SHIFTS;

        state.analysisResult = ShiftAnalyzer.analyze(
            state.schedule, dateMeta, state.employees, shifts
        );

        $analysisPanel.style.display = 'block';
        renderWarningBanner();
        renderOverviewTab();
        renderWeeklyTab();
        renderFairnessTab();
        renderEmployeeReportsTab();
    }

    // === 预警横幅 ===
    function renderWarningBanner() {
        var r = state.analysisResult;
        if (r.warnings.length === 0) {
            $warningBanner.style.display = 'none';
            return;
        }

        var html = '<div class="warning-icon">⚠️</div><div class="warning-list">';
        r.warnings.forEach(function(w) {
            html += '<div class="warning-item">' + w.icon + ' ' + w.text + '</div>';
        });
        html += '</div>';
        $warningBanner.innerHTML = html;
        $warningBanner.style.display = 'flex';
    }

    // === 总览标签页 ===
    function renderOverviewTab() {
        var r = state.analysisResult;

        // 建议区
        var sugHtml = '<div class="suggestions-title">💡 智能建议</div>';
        r.suggestions.forEach(function(s) {
            sugHtml += '<div class="suggestion-item">' +
                '<span class="sug-icon">' + s.icon + '</span>' +
                '<span class="sug-text">' + s.text + '</span>' +
            '</div>';
        });
        $suggestionsArea.innerHTML = sugHtml;

        // 幸福指数排名
        var sorted = state.employees.slice().sort(function(a, b) {
            return r.employees[b].score - r.employees[a].score;
        });

        var rankHtml = '<div class="ranking-title">😊 幸福指数排名</div>';
        rankHtml += '<div class="ranking-list">';
        sorted.forEach(function(name, idx) {
            var emp = r.employees[name];
            var color = COLORS[state.employees.indexOf(name) % COLORS.length];
            var scoreColor = emp.score >= 75 ? '#059669' :
                             emp.score >= 50 ? '#d97706' : '#dc2626';
            var medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : (idx + 1);
            var issueCount = emp.issues.length;
            var issueTag = issueCount > 0 ?
                '<span class="issue-count" style="background:' +
                (emp.issues.some(function(i) { return i.level === 'danger'; }) ? '#fef2f2;color:#dc2626' : '#fffbeb;color:#d97706') +
                '">' + issueCount + '个问题</span>' : '<span class="issue-count ok">无问题</span>';

            rankHtml += '<div class="ranking-item">';
            rankHtml += '<span class="rank-medal">' + medal + '</span>';
            rankHtml += '<span class="rank-name" style="color:' + color + '">' + name + '</span>';
            rankHtml += '<div class="rank-bar-wrapper">';
            rankHtml += '<div class="rank-bar" style="width:' + emp.score + '%;background:' + scoreColor + '"></div>';
            rankHtml += '</div>';
            rankHtml += '<span class="rank-score" style="color:' + scoreColor + '">' + emp.score + '分</span>';
            rankHtml += issueTag;
            rankHtml += '</div>';
        });
        rankHtml += '</div>';
        $happinessRanking.innerHTML = rankHtml;
    }

    // === 每周详情标签页 ===
    function renderWeeklyTab() {
        var r = state.analysisResult;
        var weeks = r.weeklyBreakdown;
        var weekKeys = Object.keys(weeks).sort(function(a, b) { return a - b; });

        var html = '<table class="weekly-table"><thead><tr>';
        html += '<th>员工</th>';
        weekKeys.forEach(function(wk) {
            var w = weeks[wk];
            var typeLabel = w.weekType === 'big' ? '大休周' : '小休周';
            // 显示日期范围
            var firstDate = w.dates[0].slice(5); // MM-DD
            var lastDate = w.dates[w.dates.length - 1].slice(5);
            html += '<th>第' + (parseInt(wk) + 1) + '周<br><small>' + firstDate + '~' + lastDate + '</small><br><small class="week-type-label ' + w.weekType + '">' + typeLabel + '</small></th>';
        });
        html += '</tr></thead><tbody>';

        state.employees.forEach(function(name) {
            var emp = r.employees[name];
            html += '<tr><td class="name-cell">' + name + '</td>';
            weekKeys.forEach(function(wk) {
                var wr = emp.weeklyRest[wk];
                if (!wr) {
                    html += '<td>-</td>';
                    return;
                }
                var restCount = wr.restDays.length;
                var restDatesStr = wr.restDays.map(function(d) {
                    var day = new Date(d).getDay();
                    return d.slice(8) + '(' + DAY_NAMES[day] + ')';
                }).join(' ');

                html += '<td>';
                html += '<span class="weekly-rest-badge" style="background:' + wr.color + '20;color:' + wr.color + ';border:1px solid ' + wr.color + '40">';
                html += wr.label;
                html += '</span>';
                if (restCount > 0) {
                    html += '<div class="weekly-rest-dates">' + restDatesStr + '</div>';
                }
                html += '</td>';
            });
            html += '</tr>';
        });

        html += '</tbody></table>';
        $weeklyRestGrid.innerHTML = html;
    }

    // === 公平性标签页 ===
    function renderFairnessTab() {
        var r = state.analysisResult;
        var f = r.fairness;

        var html = '<div class="fairness-cards">';

        // 工作天数对比
        html += _buildFairnessCard('📊 工作天数', f.workDays, '天', state.employees, function(name) {
            return r.employees[name].workDays.length;
        });

        // 总工时对比
        html += _buildFairnessCard('⏱️ 总工时', f.workHours, '小时', state.employees, function(name) {
            return r.employees[name].totalWorkHours;
        });

        // 休息天数对比
        html += _buildFairnessCard('😴 休息天数', f.restDays, '天', state.employees, function(name) {
            return r.employees[name].shiftCounts.rest;
        });

        // 周末值班对比
        html += _buildFairnessCard('📅 周末值班', f.weekendDuty, '天', state.employees, function(name) {
            return r.employees[name].weekendDutyDays.length;
        });

        html += '</div>';

        // 标准差提示
        html += '<div class="fairness-summary">';
        html += '<div class="fairness-metric">工作天数标准差: <strong>' + f.workDays.std + '</strong> ' + _stdLevel(f.workDays.std, 2) + '</div>';
        html += '<div class="fairness-metric">工时标准差: <strong>' + f.workHours.std + '</strong> ' + _stdLevel(f.workHours.std, 15) + '</div>';
        html += '<div class="fairness-metric">周末值班标准差: <strong>' + f.weekendDuty.std + '</strong> ' + _stdLevel(f.weekendDuty.std, 1.5) + '</div>';
        html += '</div>';

        $fairnessDashboard.innerHTML = html;
    }

    function _buildFairnessCard(title, metric, unit, employees, getValue) {
        var maxVal = metric.max || 1;
        var html = '<div class="fairness-card">';
        html += '<div class="fc-title">' + title + ' <small>(均值' + metric.avg + unit + ')</small></div>';
        html += '<div class="fc-bars">';

        // 按值排序
        var sorted = employees.slice().sort(function(a, b) { return getValue(b) - getValue(a); });
        sorted.forEach(function(name) {
            var val = getValue(name);
            var pct = Math.round(val / maxVal * 100);
            var color = COLORS[employees.indexOf(name) % COLORS.length];
            html += '<div class="fc-bar-row">';
            html += '<span class="fc-bar-name">' + name + '</span>';
            html += '<div class="fc-bar-track"><div class="fc-bar-fill" style="width:' + pct + '%;background:' + color + '"></div></div>';
            html += '<span class="fc-bar-value">' + val + unit + '</span>';
            html += '</div>';
        });

        html += '</div></div>';
        return html;
    }

    function _stdLevel(std, threshold) {
        if (std <= threshold * 0.5) return '<span class="level-good">✅ 非常均衡</span>';
        if (std <= threshold) return '<span class="level-ok">🟡 基本均衡</span>';
        return '<span class="level-bad">🔴 偏差较大</span>';
    }

    // === 个人报告标签页 ===
    function renderEmployeeReportsTab() {
        var r = state.analysisResult;
        var html = '';

        state.employees.forEach(function(name, i) {
            var emp = r.employees[name];
            var color = COLORS[i % COLORS.length];
            var scoreColor = emp.score >= 75 ? '#059669' : emp.score >= 50 ? '#d97706' : '#dc2626';

            html += '<div class="emp-report">';
            html += '<div class="emp-report-header">';
            html += '<div class="emp-report-name" style="color:' + color + '">';
            html += '<span class="avatar" style="background:' + color + '">' + name.charAt(0) + '</span>';
            html += name;
            html += '</div>';
            html += '<div class="emp-report-score" style="color:' + scoreColor + '">';
            html += '<span class="score-num">' + emp.score + '</span><span class="score-label">幸福指数</span>';
            html += '</div>';
            html += '</div>';

            // 关键指标
            html += '<div class="emp-metrics">';
            html += '<div class="emp-metric"><span class="em-label">工作天数</span><span class="em-value">' + emp.workDays.length + '天</span></div>';
            html += '<div class="emp-metric"><span class="em-label">休息天数</span><span class="em-value">' + emp.shiftCounts.rest + '天</span></div>';
            html += '<div class="emp-metric"><span class="em-label">总工时</span><span class="em-value">' + emp.totalWorkHours + 'h</span></div>';
            html += '<div class="emp-metric"><span class="em-label">最长连续工作</span><span class="em-value">' + emp.maxConsecutiveWork + '天</span></div>';
            html += '<div class="emp-metric"><span class="em-label">周末值班</span><span class="em-value">' + emp.weekendDutyDays.length + '天</span></div>';
            html += '<div class="emp-metric"><span class="em-label">最长连续休息</span><span class="em-value">' + emp.longestRest + '天</span></div>';
            html += '<div class="emp-metric"><span class="em-label">有双休</span><span class="em-value">' + (emp.hasDoubleRest ? '✅ 是' : '❌ 无') + '</span></div>';
            html += '<div class="emp-metric"><span class="em-label">班次分布</span><span class="em-value">早' + emp.shiftCounts.morning + ' 中' + emp.shiftCounts.middle + ' 晚' + (emp.shiftCounts.night || 0) + '</span></div>';
            html += '</div>';

            // 问题列表
            if (emp.issues.length > 0) {
                html += '<div class="emp-issues">';
                emp.issues.forEach(function(issue) {
                    html += '<div class="emp-issue ' + issue.level + '">' + issue.icon + ' ' + issue.text + '</div>';
                });
                html += '</div>';
            } else {
                html += '<div class="emp-issues"><div class="emp-issue ok">✅ 排班合理，没有发现问题</div></div>';
            }

            html += '</div>';
        });

        $employeeReports.innerHTML = html;
    }

    // === 分析标签切换 ===
    function switchAnalysisTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(function(btn) {
            btn.classList.toggle('active', btn.getAttribute('data-tab') === tab);
        });
        document.querySelectorAll('.tab-content').forEach(function(tc) {
            tc.classList.toggle('active', tc.id === 'tab-' + tab);
        });
    }

    // === 日历视图 ===
    function renderCalendar() {
        var scheduler = state.scheduler;
        var dateMeta = scheduler.getDateMeta();
        var schedule = state.schedule;
        var dates = Object.keys(dateMeta).sort();
        if (dates.length === 0) return;

        var firstDate = new Date(dates[0]);
        var startDayOfWeek = firstDate.getDay();
        var offset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

        var html = '<div class="calendar-grid">';
        var headers = ['一','二','三','四','五','六','日'];
        headers.forEach(function(h, i) {
            var cls = i >= 5 ? ' weekend' : '';
            html += '<div class="calendar-header' + cls + '">' + h + '</div>';
        });

        for (var i = 0; i < offset; i++) {
            html += '<div class="calendar-cell empty"></div>';
        }

        dates.forEach(function(dateStr) {
            var meta = dateMeta[dateStr];
            var daySched = schedule[dateStr];
            var cellClass = 'calendar-cell';
            if (meta.isWeekend) cellClass += ' weekend';
            if (meta.isRest) cellClass += ' rest-day';

            var typeLabel = '';
            if (meta.isRest && meta.weekType === 'big') {
                typeLabel = '<span class="day-type big-rest">大休</span>';
            } else if (meta.isRest && meta.weekType === 'small') {
                typeLabel = '<span class="day-type small-rest">小休</span>';
            } else if (meta.isWeekend) {
                typeLabel = '<span class="day-type workday">值班</span>';
            }

            html += '<div class="' + cellClass + '" data-date="' + dateStr + '">';
            html += '<div class="calendar-date">';
            html += '<span class="day-num">' + meta.dayNum + '</span>';
            html += typeLabel;
            html += '</div>';
            html += '<div class="calendar-shifts">';

            scheduler.SHIFTS.forEach(function(shift) {
                var people = daySched[shift] || [];
                if (people.length > 0) {
                    html += '<div class="calendar-shift-row">';
                    html += '<span class="mini-badge ' + shift + '">' + SHIFT_LABELS[shift] + '</span>';
                    html += '<span class="names">' + people.join(', ') + '</span>';
                    html += '</div>';
                }
            });

            var restPeople = daySched.rest || [];
            if (restPeople.length > 0) {
                html += '<div class="calendar-shift-row">';
                html += '<span class="mini-badge rest-badge">休</span>';
                html += '<span class="names">' + restPeople.join(', ') + '</span>';
                html += '</div>';
            }

            html += '</div></div>';
        });

        html += '</div>';
        $scheduleContainer.innerHTML = html;

        $scheduleContainer.querySelectorAll('.calendar-cell:not(.empty)').forEach(function(cell) {
            cell.addEventListener('click', function() {
                openEditModal(this.getAttribute('data-date'));
            });
        });
    }

    // === 列表视图 ===
    function renderList() {
        var scheduler = state.scheduler;
        var dateMeta = scheduler.getDateMeta();
        var schedule = state.schedule;
        var dates = Object.keys(dateMeta).sort();

        var html = '<div class="list-wrapper"><table class="list-table"><thead><tr>';
        html += '<th class="name-col">员工</th>';

        dates.forEach(function(dateStr) {
            var meta = dateMeta[dateStr];
            var cls = meta.isWeekend ? ' weekend' : '';
            html += '<th class="' + cls + '">' + meta.dayNum + '<br><small>' + DAY_NAMES[meta.dayOfWeek] + '</small></th>';
        });
        html += '</tr></thead><tbody>';

        state.employees.forEach(function(name) {
            html += '<tr><td class="name-cell">' + name + '</td>';
            dates.forEach(function(dateStr) {
                var meta = dateMeta[dateStr];
                var daySched = schedule[dateStr];
                var cellCls = meta.isWeekend ? ' weekend-cell' : '';
                var shift = getEmployeeShift(daySched, name, scheduler.SHIFTS);

                html += '<td class="' + cellCls + '">';
                html += '<span class="cell-badge ' + shift + '" data-date="' + dateStr + '" data-name="' + name + '">';
                html += SHIFT_LABELS[shift];
                html += '</span></td>';
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        $scheduleContainer.innerHTML = html;

        $scheduleContainer.querySelectorAll('.cell-badge').forEach(function(badge) {
            badge.addEventListener('click', function(e) {
                e.stopPropagation();
                openEditModal(this.getAttribute('data-date'));
            });
        });
    }

    function getEmployeeShift(daySched, name, shifts) {
        for (var i = 0; i < shifts.length; i++) {
            if (daySched[shifts[i]] && daySched[shifts[i]].indexOf(name) >= 0) {
                return shifts[i];
            }
        }
        return 'rest';
    }

    function renderSchedule() {
        if (!state.schedule) return;
        if (state.currentView === 'calendar') {
            renderCalendar();
        } else {
            renderList();
        }
    }

    function switchView(view) {
        state.currentView = view;
        $btnViewCalendar.classList.toggle('active', view === 'calendar');
        $btnViewList.classList.toggle('active', view === 'list');
        renderSchedule();
    }

    // === 统计面板 ===
    function renderStats() {
        if (!state.scheduler) return;
        var stats = state.scheduler.getStats();
        $statsPanel.style.display = 'block';

        var html = '';
        state.employees.forEach(function(name, i) {
            var s = stats[name];
            if (!s) return;
            var color = COLORS[i % COLORS.length];

            html += '<div class="stat-card">';
            html += '<div class="stat-name" style="color:' + color + '">' + name + '</div>';
            html += '<div class="stat-values">';
            html += '<span class="stat-tag morning">早' + s.morning + '</span>';
            html += '<span class="stat-tag middle">中' + s.middle + '</span>';
            if (s.night !== undefined) {
                html += '<span class="stat-tag night">晚' + s.night + '</span>';
            }
            html += '<span class="stat-tag rest">休' + s.rest + '</span>';
            html += '<span class="stat-tag total">总' + s.totalWork + '</span>';
            html += '</div></div>';
        });

        $statsGrid.innerHTML = html;
    }

    // === 编辑弹窗（含快照对比功能） ===
    function openEditModal(dateStr) {
        if (!state.scheduler || !state.schedule) return;

        var meta = state.scheduler.getDateMeta()[dateStr];
        var daySched = state.schedule[dateStr];
        var shifts = state.scheduler.SHIFTS;

        // 保存编辑前快照（深拷贝当天数据）
        state.snapshotBeforeEdit = {};
        var allShifts = shifts.concat(['rest']);
        allShifts.forEach(function(s) {
            state.snapshotBeforeEdit[s] = (daySched[s] || []).slice();
        });
        state.snapshotBeforeEdit._date = dateStr;

        $modalTitle.textContent = dateStr + '（周' + DAY_NAMES[meta.dayOfWeek] + '）排班编辑';

        var html = '<div class="edit-hint">💡 修改后系统会自动重新分析，告诉你这次调整的影响</div>';
        state.employees.forEach(function(name) {
            var current = getEmployeeShift(daySched, name, shifts);

            // 如果有分析数据，显示此人当前状态标记
            var statusTag = '';
            if (state.analysisResult) {
                var emp = state.analysisResult.employees[name];
                if (emp && emp.issues.length > 0) {
                    var worstLevel = emp.issues.some(function(i) { return i.level === 'danger'; }) ? 'danger' : 'warning';
                    statusTag = '<span class="edit-status ' + worstLevel + '">' + emp.issues.length + '⚠</span>';
                }
            }

            html += '<div class="edit-row">';
            html += '<span class="edit-name">' + name + statusTag + '</span>';
            html += '<select data-name="' + name + '">';
            shifts.forEach(function(s) {
                var sel = s === current ? ' selected' : '';
                html += '<option value="' + s + '"' + sel + '>' + SHIFT_NAMES[s] + '</option>';
            });
            html += '<option value="rest"' + (current === 'rest' ? ' selected' : '') + '>休息</option>';
            html += '</select></div>';
        });

        $modalBody.innerHTML = html;
        $modal.style.display = 'flex';

        $modalSave.onclick = function() {
            // 执行修改
            $modalBody.querySelectorAll('select').forEach(function(sel) {
                var empName = sel.getAttribute('data-name');
                var newShift = sel.value;
                state.scheduler.updateShift(dateStr, empName, newShift);
            });

            // 重新分析（修改后对比）
            var oldAnalysis = state.analysisResult;
            renderSchedule();
            renderStats();
            runAnalysis();
            closeModal();

            // 构建影响报告
            showImpactReport(dateStr, oldAnalysis);
        };
    }

    // === 影响报告弹窗 ===
    function showImpactReport(dateStr, oldAnalysis) {
        if (!state.analysisResult || !oldAnalysis) {
            showToast('已更新 ' + dateStr + ' 排班');
            return;
        }

        var newR = state.analysisResult;
        var changes = [];

        state.employees.forEach(function(name) {
            var oldEmp = oldAnalysis.employees[name];
            var newEmp = newR.employees[name];
            if (!oldEmp || !newEmp) return;

            var diff = {
                name: name,
                scoreChange: newEmp.score - oldEmp.score,
                oldScore: oldEmp.score,
                newScore: newEmp.score,
                restChange: newEmp.shiftCounts.rest - oldEmp.shiftCounts.rest,
                newIssues: [],
                resolvedIssues: []
            };

            // 找出新增问题
            newEmp.issues.forEach(function(ni) {
                var existed = oldEmp.issues.some(function(oi) { return oi.text === ni.text; });
                if (!existed) diff.newIssues.push(ni);
            });

            // 找出解决的问题
            oldEmp.issues.forEach(function(oi) {
                var stillExists = newEmp.issues.some(function(ni) { return ni.text === oi.text; });
                if (!stillExists) diff.resolvedIssues.push(oi);
            });

            if (diff.scoreChange !== 0 || diff.restChange !== 0 || diff.newIssues.length > 0 || diff.resolvedIssues.length > 0) {
                changes.push(diff);
            }
        });

        if (changes.length === 0) {
            showToast('已更新 ' + dateStr + ' 排班（无显著影响）');
            return;
        }

        // 渲染影响报告
        var html = '<div class="impact-date">📅 调整日期：' + dateStr + '</div>';
        html += '<div class="impact-list">';

        changes.forEach(function(c) {
            var scoreArrow = c.scoreChange > 0 ? '↑' : c.scoreChange < 0 ? '↓' : '→';
            var scoreClass = c.scoreChange > 0 ? 'improved' : c.scoreChange < 0 ? 'worsened' : 'neutral';

            html += '<div class="impact-person">';
            html += '<div class="impact-name">' + c.name + '</div>';

            // 幸福指数变化
            html += '<div class="impact-score ' + scoreClass + '">';
            html += '幸福指数 ' + c.oldScore + ' ' + scoreArrow + ' ' + c.newScore;
            if (c.scoreChange !== 0) {
                html += ' <span class="score-delta">(' + (c.scoreChange > 0 ? '+' : '') + c.scoreChange + ')</span>';
            }
            html += '</div>';

            // 休息天数变化
            if (c.restChange !== 0) {
                var restIcon = c.restChange > 0 ? '😊 获得休息' : '😔 失去休息';
                html += '<div class="impact-rest ' + (c.restChange > 0 ? 'gained' : 'lost') + '">' + restIcon + '（' + (c.restChange > 0 ? '+' : '') + c.restChange + '天）</div>';
            }

            // 新增问题
            c.newIssues.forEach(function(issue) {
                html += '<div class="impact-issue new">⚠️ 新增问题：' + issue.text + '</div>';
            });

            // 解决的问题
            c.resolvedIssues.forEach(function(issue) {
                html += '<div class="impact-issue resolved">✅ 已解决：' + issue.text + '</div>';
            });

            html += '</div>';
        });

        html += '</div>';
        $modalImpactBody.innerHTML = html;
        $modalImpact.style.display = 'flex';
    }

    function closeModal() { $modal.style.display = 'none'; }
    function closeImpactModal() { $modalImpact.style.display = 'none'; }

    // === 导出 ===
    function exportSchedule() {
        if (!state.schedule || !state.scheduler) {
            showToast('请先生成排班表');
            return;
        }

        var dateMeta = state.scheduler.getDateMeta();
        var dates = Object.keys(dateMeta).sort();
        var shifts = state.scheduler.SHIFTS;

        var lines = [];
        var header = ['员工'];
        dates.forEach(function(d) {
            var meta = dateMeta[d];
            header.push(meta.dayNum + '(' + DAY_NAMES[meta.dayOfWeek] + ')');
        });
        lines.push(header.join(','));

        state.employees.forEach(function(name) {
            var row = [name];
            dates.forEach(function(dateStr) {
                var daySched = state.schedule[dateStr];
                var shift = getEmployeeShift(daySched, name, shifts);
                row.push(SHIFT_NAMES[shift]);
            });
            lines.push(row.join(','));
        });

        var csv = '\uFEFF' + lines.join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = '排班表_' + ($inputMonth.value || 'schedule') + '.csv';
        a.click();
        URL.revokeObjectURL(url);
        showToast('已导出 CSV 文件');
    }

    // === 本地持久化 ===
    function saveState() {
        try {
            localStorage.setItem('shift-scheduler-employees', JSON.stringify(state.employees));
            localStorage.setItem('shift-scheduler-month', $inputMonth.value);
            localStorage.setItem('shift-scheduler-firstWeek', $selectFirstWeek.value);
        } catch (e) {}
    }

    function loadState() {
        try {
            var saved = localStorage.getItem('shift-scheduler-employees');
            if (saved) state.employees = JSON.parse(saved);
            var month = localStorage.getItem('shift-scheduler-month');
            if (month) $inputMonth.value = month;
            var fw = localStorage.getItem('shift-scheduler-firstWeek');
            if (fw) $selectFirstWeek.value = fw;
        } catch (e) {}
    }

    // === Toast ===
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
