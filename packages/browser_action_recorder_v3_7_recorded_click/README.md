# browser_action_recorder_v3_7_recorded_click

Đây là mục lục theo cấu trúc gói ZIP Recorder.

Source chạy thực tế nằm tại:

```text
recorder/
```

Cây thư mục tương ứng:

```text
browser_action_recorder_v3_7_recorded_click/
├─ manifest.json
├─ background.js
├─ content.js
├─ popup.html
├─ popup.js
├─ ACTION_CONTRACT.json
└─ README.md
```

Recorder hiện tại:

- tab-persistent recording;
- semantic final-value cho text edit;
- `clickRecorded` với điểm tương đối `rx/ry`;
- `scrollTo` deterministic;
- popup 3 nút Start / Stop / Export .js;
- nhớ thư mục export nếu browser cho phép.

## Cài

Trong `chrome://extensions` chọn **Load unpacked** hoặc **Reload** tại:

```text
recorder\
```

Lưu ý: thư mục `packages/...` này chỉ là index theo tên ZIP cũ; source thật chỉ duy trì tại `recorder/`.
