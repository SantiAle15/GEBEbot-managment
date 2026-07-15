import * as state from "./state.js";

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();
let selectedDate = null;

const monthNames = [
  "ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO",
  "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"
];

export function initCalendar() {
  renderCalendar();
  
  document.getElementById("cal-prev")?.addEventListener("click", () => {
    changeMonth(-1);
  });
  
  document.getElementById("cal-next")?.addEventListener("click", () => {
    changeMonth(1);
  });
  
  state.subscribe(() => {
    renderCalendar();
  });
}

function changeMonth(delta) {
  currentMonth += delta;
  if (currentMonth < 0) {
    currentMonth = 11;
    currentYear--;
  } else if (currentMonth > 11) {
    currentMonth = 0;
    currentYear++;
  }
  renderCalendar();
}

function renderCalendar() {
  const yearEl = document.getElementById("cal-year");
  const titleEl = document.getElementById("cal-title");
  const gridEl = document.getElementById("cal-grid-days");
  
  if (!yearEl || !titleEl || !gridEl) return;
  
  yearEl.textContent = currentYear;
  titleEl.textContent = monthNames[currentMonth];
  titleEl.setAttribute("data-month", currentMonth);
  
  gridEl.innerHTML = "";
  
  const firstDay = new Date(currentYear, currentMonth, 1);
  const lastDay = new Date(currentYear, currentMonth + 1, 0);
  const daysInMonth = lastDay.getDate();
  
  let startDay = firstDay.getDay() - 1;
  if (startDay < 0) startDay = 6;
  
  // Siempre 6 filas x 7 dias = 42 celdas, para que el calendario mida
  // EXACTAMENTE lo mismo todos los meses (antes variaba entre 4, 5 y 6
  // filas segun en que dia cayera el 1, y el recuadro cambiaba de alto).
  const TOTAL_CELLS = 42;

  for (let i = 0; i < startDay; i++) {
    const emptyDay = document.createElement("div");
    emptyDay.className = "cal-day empty";
    gridEl.appendChild(emptyDay);
  }
  
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tasks = state.getTasks();
  const habits = state.getHabits();
  
  for (let day = 1; day <= daysInMonth; day++) {
    const dayEl = document.createElement("div");
    dayEl.className = "cal-day";
    
    const dateStr = formatDateForStorage(currentYear, currentMonth, day);
    const currentDate = new Date(currentYear, currentMonth, day);
    currentDate.setHours(0, 0, 0, 0);
    
    const isToday = (
      today.getFullYear() === currentYear &&
      today.getMonth() === currentMonth &&
      today.getDate() === day
    );
    
    const isFuture = currentDate > today;
    
    if (isToday) dayEl.classList.add("today");
    if (isFuture) dayEl.classList.add("future");
    if (selectedDate === dateStr) dayEl.classList.add("selected");
    
    const dayNumber = document.createElement("div");
    dayNumber.className = "cal-day-number";
    dayNumber.textContent = day;
    dayEl.appendChild(dayNumber);
    
    const dayTasks = tasks.filter(t => t.date === dateStr);
    const dayHabits = habits.filter(h => {
      if (!h.startDate) return false;
      const startDate = new Date(h.startDate);
      
      if (h.recurrence === "daily") return currentDate >= startDate;
      if (h.recurrence === "weekly") {
        return currentDate >= startDate && currentDate.getDay() === startDate.getDay();
      }
      if (h.recurrence === "monthly") {
        return currentDate >= startDate && currentDate.getDate() === startDate.getDate();
      }
      return h.startDate === dateStr;
    });
    
    if (dayTasks.length > 0 || dayHabits.length > 0) {
      const capsContainer = document.createElement("div");
      capsContainer.className = "cal-caps";
      
      if (dayTasks.length > 0) {
        const taskCap = document.createElement("div");
        taskCap.className = "cal-cap task";
        
        const taskCount = document.createElement("span");
        taskCount.className = "cal-cap-count";
        taskCount.textContent = dayTasks.length;
        taskCap.appendChild(taskCount);
        
        capsContainer.appendChild(taskCap);
      }
      
      if (dayHabits.length > 0) {
        const habitCap = document.createElement("div");
        habitCap.className = "cal-cap habit";
        
        const habitCount = document.createElement("span");
        habitCount.className = "cal-cap-count";
        habitCount.textContent = dayHabits.length;
        habitCap.appendChild(habitCount);
        
        capsContainer.appendChild(habitCap);
      }
      
      dayEl.appendChild(capsContainer);
    }
    
    dayEl.addEventListener("click", () => {
      selectedDate = dateStr;
      renderCalendar();
      showDayDetail(dateStr, dayTasks, dayHabits);
    });
    
    gridEl.appendChild(dayEl);
  }

  // Relleno final hasta completar las 6 filas
  const used = startDay + daysInMonth;
  for (let i = used; i < TOTAL_CELLS; i++) {
    const emptyDay = document.createElement("div");
    emptyDay.className = "cal-day empty";
    gridEl.appendChild(emptyDay);
  }
}

function showDayDetail(dateStr, tasks, habits) {
  const detailEl = document.getElementById("cal-detail");
  if (!detailEl) return;
  
  const [year, month, day] = dateStr.split('-');
  const dateFormatted = `${day}/${month}/${year}`;
  
  let html = `<h3>${dateFormatted}</h3>`;
  
  if (tasks.length === 0 && habits.length === 0) {
    html += '<p class="cal-detail-hint">Sin actividad para este día</p>';
  } else {
    // Ordenar por hora de inicio
    const allItems = [
      ...tasks.map(t => ({ ...t, type: 'task' })),
      ...habits.map(h => ({ ...h, type: 'habit' }))
    ].sort((a, b) => {
      const timeA = a.timeStart || '00:00';
      const timeB = b.timeStart || '00:00';
      return timeA.localeCompare(timeB);
    });
    
    html += '<div class="cal-detail-blocks">';
    
    allItems.forEach(item => {
      const timeDisplay = formatTimeRange(item.timeStart, item.timeEnd);
      const isTask = item.type === 'task';
      const status = isTask ? (item.completed ? "✓" : "○") : (item.completedDates?.includes(dateStr) ? "✓" : "○");
      
      html += `
        <div class="cal-hour-block ${isTask ? 'task-block' : 'habit-block'}">
          <div class="cal-hour-time">${timeDisplay || 'Todo el día'}</div>
          <div class="cal-hour-content">
            <div class="cal-hour-title">${status} ${escapeHtml(item.title)}</div>
            ${item.description ? `<div class="cal-hour-meta">${escapeHtml(item.description)}</div>` : ''}
          </div>
        </div>
      `;
    });
    
    html += '</div>';
  }
  
  detailEl.innerHTML = html;
}

function formatDateForStorage(year, month, day) {
  const m = String(month + 1).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

function formatTimeRange(timeStart, timeEnd) {
  if (!timeStart) return "";
  if (timeEnd) return `${timeStart} - ${timeEnd}`;
  return timeStart;
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}