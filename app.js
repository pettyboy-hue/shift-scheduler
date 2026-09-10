/**
 * 排班系统前端交互
 * 负责：员工管理、生成排班、日历/列表渲染、手动编辑、导出、本地持久化
 */

(function() {
    'use strict';

    // === 状态 ===
    var state = {
        employees: [],
        scheduler: null,
        schedule: null,
        currentView: 'calendar' // 'calendar' | 'list'
    };

    // 头像颜色池
    var COLORS = [
        '#4f46e5','#059669','#d97706','#dc2626','#7c3aed',
        '#0891b2','#be185d','#65a30d','#ea580c','#6366f1',
        '#0d9488','#ca8a04','#e11d48','#8b5cf6','#2563eb'
    ];

    var SHIFT_LABELS = { morning: '早', middle: '中', night: '晚', rest: '休' };
    var SHIFT_NAMES = { morning: '早班', middle: '中班', night: '晚班', rest: '休息' };
    var DAY_NAMES = ['日','一','二','三','四','五','六'];

    // === DOM 元素缓存 ===
    var $inputEmployee = document.getElementById('input-employee');
    var $btnAddEmployee = document.getElementById('btn-add-employee');
    var $employeeList = document.getElementById('employee-list');
    var $btnDemoEmployees = document.getElementById('btn-demo-employees');
    var $inputMonth = document.getElementById('input-month');
    var $selectFirstWeek = document.getElementById('select-first-week');
    var $inputWeekdayCount = document.getElementById('input-weekday-count');
    var $inputWeekendCount = document.getElementById('input-weekend-count');
    var $checkNightShift = document.getElementById('check-night-shift');
    var $btnGenerate = document.getElementById('btn-generate');
    var $btnExport = document.getElementById('btn-export');
    var $btnSave = document.getElementById('btn-save');
    var $btnViewCalendar = document.getElementById('btn-view-calendar');
    var $btnViewList = document.getElementById('btn-view-list');
    var $scheduleContainer = document.getElementById('schedule-container');
    var $statsPanel = document.getElementById('stats-panel');
    var $statsGrid = document.getElementById('stats-grid');
    var $modal = document.getElementById('modal-edit');
    var $modalTitle = document.getElementById('modal-title');
    var $modalBody = document.getElementById('modal-body');
    var $modalClose = document.getElementById('modal-close');
    var $modalCancel = document.getElementById('modal-cancel');
    var $modalSave = document.getElementById('modal-save');

    // === 初始化 ===
    function init() {
        // 默认月份为当前月
        var now = new Date();
        var y = now.getFullYear();
        var m = String(now.getMonth() + 1);
        if (m.length < 2) m = '0' + m;
        $inputMonth.value = y + '-' + m;

        // 从 localStorage 恢复
        loadState();
        renderEmployeeList();

        // 绑定事件
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

        // 绑定删除事件
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
            saveState();
            showToast('排班生成成功！共 ' + Object.keys(state.schedule).length + ' 天');
        } catch (e) {
            showToast(e.message);
        }
    }

    // === 日历视图 ===
    function renderCalendar() {
        var scheduler = state.scheduler;
        var dateMeta = scheduler.getDateMeta();
        var schedule = state.schedule;
        var dates = Object.keys(dateMeta).sort();
        if (dates.length === 0) return;

        var firstDate = new Date(dates[0]);
        var startDayOfWeek = firstDate.getDay(); // 0=周日

        // 调整为周一开始：把周日变成6，其他减1
        var offset = startDayOfWeek === 0 ? 6 : startDayOfWeek - 1;

        var html = '<div class="calendar-grid">';

        // 星期头部（周一开始）
        var headers = ['一','二','三','四','五','六','日'];
        headers.forEach(function(h, i) {
            var cls = i >= 5 ? ' weekend' : '';
            html += '<div class="calendar-header' + cls + '">' + h + '</div>';
        });

        // 空白填充
        for (var i = 0; i < offset; i++) {
            html += '<div class="calendar-cell empty"></div>';
        }

        // 日期格子
        dates.forEach(function(dateStr) {
            var meta = dateMeta[dateStr];
            var daySched = schedule[dateStr];

            var cellClass = 'calendar-cell';
            if (meta.isWeekend) cellClass += ' weekend';
            if (meta.isRest) cellClass += ' rest-day';

            // 日期类型标记
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

            var shifts = scheduler.SHIFTS;
            shifts.forEach(function(shift) {
                var people = daySched[shift] || [];
                if (people.length > 0) {
                    html += '<div class="calendar-shift-row">';
                    html += '<span class="mini-badge ' + shift + '">' + SHIFT_LABELS[shift] + '</span>';
                    html += '<span class="names">' + people.join(', ') + '</span>';
                    html += '</div>';
                }
            });

            // 休息人员
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

        // 绑定日期格子点击事件（打开编辑弹窗）
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
                html += '</span>';
                html += '</td>';
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';
        $scheduleContainer.innerHTML = html;

        // 绑定单元格点击
        $scheduleContainer.querySelectorAll('.cell-badge').forEach(function(badge) {
            badge.addEventListener('click', function(e) {
                e.stopPropagation();
                openEditModal(this.getAttribute('data-date'));
            });
        });
    }

    // 查找某人在某天的班次
    function getEmployeeShift(daySched, name, shifts) {
        for (var i = 0; i < shifts.length; i++) {
            if (daySched[shifts[i]] && daySched[shifts[i]].indexOf(name) >= 0) {
                return shifts[i];
            }
        }
        if (daySched.rest && daySched.rest.indexOf(name) >= 0) {
            return 'rest';
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

    // === 编辑弹窗 ===
    function openEditModal(dateStr) {
        if (!state.scheduler || !state.schedule) return;

        var meta = state.scheduler.getDateMeta()[dateStr];
        var daySched = state.schedule[dateStr];
        var shifts = state.scheduler.SHIFTS;

        $modalTitle.textContent = dateStr + '（周' + DAY_NAMES[meta.dayOfWeek] + '）排班编辑';

        var html = '';
        state.employees.forEach(function(name) {
            var current = getEmployeeShift(daySched, name, shifts);
            html += '<div class="edit-row">';
            html += '<span class="edit-name">' + name + '</span>';
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

        // 保存按钮
        $modalSave.onclick = function() {
            $modalBody.querySelectorAll('select').forEach(function(sel) {
                var empName = sel.getAttribute('data-name');
                var newShift = sel.value;
                state.scheduler.updateShift(dateStr, empName, newShift);
            });
            renderSchedule();
            closeModal();
            showToast('已更新 ' + dateStr + ' 排班');
        };
    }

    function closeModal() {
        $modal.style.display = 'none';
    }

    // === 导出 ===
    function exportSchedule() {
        if (!state.schedule || !state.scheduler) {
            showToast('请先生成排班表');
            return;
        }

        var dateMeta = state.scheduler.getDateMeta();
        var dates = Object.keys(dateMeta).sort();
        var shifts = state.scheduler.SHIFTS;

        // 生成 CSV
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

        var csv = '\uFEFF' + lines.join('\n'); // BOM 头确保 Excel 正确识别中文
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var url = URL.createObjectURL(blob);

        var a = document.createElement('a');
        a.href = url;
        var monthVal = $inputMonth.value || 'schedule';
        a.download = '排班表_' + monthVal + '.csv';
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
            if (saved) {
                state.employees = JSON.parse(saved);
            }
            var month = localStorage.getItem('shift-scheduler-month');
            if (month) $inputMonth.value = month;
            var fw = localStorage.getItem('shift-scheduler-firstWeek');
            if (fw) $selectFirstWeek.value = fw;
        } catch (e) {}
    }

    // === Toast 提示 ===
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

    // 启动
    init();

})();
