# browser_debug_agent_control_center_v3_10_assignment

Đây là mục lục theo cấu trúc gói ZIP Control Center.

Source chạy thực tế nằm tại:

```text
control-center/
```

Cây thư mục tương ứng:

```text
browser_debug_agent_control_center_v3_10_assignment/
├─ package.json
├─ package-lock.json
├─ START_CONTROL_CENTER.bat
├─ STOP_CONTROL_CENTER.bat
├─ ACTION_CONTRACT.json
├─ README.md
│
├─ manager/
│  ├─ control_center.js
│  ├─ assignment.js
│  ├─ broker.js
│  ├─ scheduler.js
│  ├─ run_queue.js
│  └─ public/
│     ├─ index.html
│     ├─ app.js
│     └─ style.css
│
├─ extension/
│  └─ stealth-extension/
│     ├─ manifest.json
│     ├─ background.js
│     └─ recorded_click.js
│
└─ script/
   └─ checks/
      ├─ run_check.js
      ├─ device_behavior.js
      ├─ imported/
      └─ variants/
```

## Dùng bản hiện tại

```bat
git pull
cd control-center
npm install
START_CONTROL_CENTER.bat
```

Stealth Executor cần load từ:

```text
control-center\extension\stealth-extension
```

Lưu ý: thư mục này là index để dễ tìm theo tên ZIP cũ; không nhân đôi source runtime tại đây.
