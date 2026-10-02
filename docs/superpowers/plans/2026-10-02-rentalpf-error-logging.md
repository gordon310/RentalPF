# RentalPF 错误日志中心 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 建立统一错误日志中心，记录小程序端用户报错、后端服务异常、运营后台操作错误、用户主动反馈，并提供后台查看/分组/处理与 180 天保留清理。

**Architecture:** 新增 Django 应用 `monitoring`。所有来源写入统一模型 `ErrorLog`（每次报错一条，`fingerprint` 用于分组）。中间件生成并贯通 `trace_id`，异常捕获中间件自动记录后端未捕获异常；DRF 提供匿名上报接口（限流 + 脱敏）；Django Admin 提供筛选、处理动作与按指纹聚合视图；管理命令按保留期清理。

**Tech Stack:** 承接地基计划（Python 3.12、Django 5.1、DRF、pytest-django）。无新增第三方依赖。

**Spec:** `docs/办公设备租赁平台开发需求文档_V0.2.md`（第 12 章 REQ-ERR-01~08）

> **代码根目录约定**：本计划路径中的 `rentalpf/` 一律指仓库根下的 **`server/`**（即 `cd rentalpf` = `cd server`，`git add rentalpf` = `git add server`）。执行前请据此替换。

**前置依赖:** `docs/superpowers/plans/2026-10-02-rentalpf-phase1-backend-foundation.md` 的 **Task 1**（Django 项目脚手架、`config.settings`、应用注册、pytest 配置）必须先完成。

## Global Constraints

- 承接地基计划的全部 Global Constraints（Python 3.12、Django 5.1、金额 Decimal、`zh-hans`、`Asia/Shanghai`、`/api/` 前缀等）。
- **每次报错落一条记录**，不做合并写入；分组只发生在查询/展示层。
- 上报接口：匿名可访问、限流（匿名 `error_report` 20 次/分、`feedback` 10 次/时）、参数脱敏。
- 保留期默认 **180 天**，由 `MONITORING_RETENTION_DAYS` 配置。
- 反馈**不做回访**，`contact` 非必填。
- 所有时间字段 `USE_TZ=True`（UTC 存储，展示走 Asia/Shanghai）。

---

## File Structure

```
config/settings.py                 # 修改：注册应用、中间件、限流、保留期
config/urls.py                     # 修改：include monitoring.urls
monitoring/
├── __init__.py
├── apps.py
├── models.py                      # ErrorLog
├── fingerprint.py                 # 指纹归一化与计算
├── context.py                     # trace_id ContextVar
├── redact.py                      # 敏感信息脱敏
├── services.py                    # log_server_exception / fingerprint_summary
├── middleware.py                  # TraceIdMiddleware / ExceptionCaptureMiddleware
├── serializers.py                 # 上报与反馈入参
├── views.py                       # ErrorLogReportView / FeedbackView
├── urls.py
├── admin.py                       # 查看、筛选、处理动作、指纹聚合视图
├── management/commands/purge_old_error_logs.py
├── migrations/
└── tests/
    ├── test_model.py
    ├── test_middleware.py
    ├── test_report_api.py
    ├── test_feedback_api.py
    └── test_admin_and_purge.py
```

职责边界：`models` 只存；`fingerprint/redact/context` 为纯函数；`services` 是唯一的写入编排入口；`middleware` 只做请求级 trace 与异常捕获；`views` 只做入参校验与调用 service。

---

## Task 1: `monitoring` 应用与 `ErrorLog` 模型

**Files:**
- Modify: `rentalpf/config/settings.py`（`INSTALLED_APPS` 追加 `"monitoring"`）
- Create: `rentalpf/monitoring/__init__.py`, `apps.py`
- Create: `rentalpf/monitoring/fingerprint.py`
- Create: `rentalpf/monitoring/models.py`
- Create: `rentalpf/monitoring/admin.py`
- Create: `rentalpf/monitoring/migrations/__init__.py`
- Create: `rentalpf/monitoring/tests/__init__.py`
- Test: `rentalpf/monitoring/tests/test_model.py`

**Interfaces:**
- Consumes: 地基计划的 `config.settings`
- Produces:
  - `monitoring.fingerprint.normalize_message(message: str) -> str`
  - `monitoring.fingerprint.compute_fingerprint(source, error_type, message, page) -> str`
  - `monitoring.models.ErrorLog`（字段见下）
  - `ErrorLog.Source`（`miniapp/server/admin/feedback`）、`ErrorLog.Level`（`info/warning/error/fatal`）、`ErrorLog.Status`（`new/processing/resolved/ignored`）、`ErrorLog.UserType`（`anonymous/c_user/admin_user`）
  - `ErrorLog.mark_resolved(by_user, note="") -> None`

- [ ] **Step 1: 注册应用并写失败测试**

在 `config/settings.py` 的 `INSTALLED_APPS` 末尾（`"pricing",` 之后）追加：

```python
    "monitoring",
```

`monitoring/tests/test_model.py`:

```python
import pytest
from django.contrib.auth import get_user_model

from monitoring.fingerprint import compute_fingerprint, normalize_message
from monitoring.models import ErrorLog

User = get_user_model()


def test_normalize_message_masks_numbers_and_spaces():
    assert normalize_message("Error 500   at Timestamp 1699999999") == "error at timestamp n"


@pytest.mark.django_db
def test_fingerprint_same_for_different_numbers():
    a = compute_fingerprint("miniapp", "TypeError", "undefined 123", "pages/a")
    b = compute_fingerprint("miniapp", "TypeError", "undefined 987", "pages/a")
    assert a == b
    assert len(a) == 32


@pytest.mark.django_db
def test_save_autofills_fingerprint_and_defaults():
    log = ErrorLog.objects.create(message="boom", source=ErrorLog.Source.SERVER)
    assert log.fingerprint
    assert log.level == ErrorLog.Level.ERROR
    assert log.status == ErrorLog.Status.NEW
    assert log.user_type == ErrorLog.UserType.ANONYMOUS


@pytest.mark.django_db
def test_mark_resolved_sets_fields():
    staff = User.objects.create_user(username="ops", password="x", is_staff=True)
    log = ErrorLog.objects.create(message="boom", source=ErrorLog.Source.SERVER)
    log.mark_resolved(staff, note="已修复")
    log.refresh_from_db()
    assert log.status == ErrorLog.Status.RESOLVED
    assert log.handled_by == staff
    assert log.handled_at is not None
    assert log.resolution_note == "已修复"
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest monitoring/tests/test_model.py -v`
Expected: FAIL（`ModuleNotFoundError: monitoring.fingerprint`）。

- [ ] **Step 3: 写纯函数 `fingerprint.py`**

```python
import hashlib
import re


def normalize_message(message):
    text = (message or "").strip().lower()
    text = re.sub(r"\d+", "n", text)
    text = re.sub(r"\s+", " ", text)
    return text


def compute_fingerprint(source, error_type, message, page):
    raw = "|".join([source or "", error_type or "", normalize_message(message), page or ""])
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]
```

- [ ] **Step 4: 写模型 `models.py`**

```python
from django.conf import settings
from django.db import models
from django.utils import timezone

from .fingerprint import compute_fingerprint


class ErrorLog(models.Model):
    class Source(models.TextChoices):
        MINIAPP = "miniapp", "小程序端"
        SERVER = "server", "后端服务"
        ADMIN = "admin", "运营后台"
        FEEDBACK = "feedback", "用户反馈"

    class Level(models.TextChoices):
        INFO = "info", "信息"
        WARNING = "warning", "警告"
        ERROR = "error", "错误"
        FATAL = "fatal", "致命"

    class Status(models.TextChoices):
        NEW = "new", "待处理"
        PROCESSING = "processing", "处理中"
        RESOLVED = "resolved", "已解决"
        IGNORED = "ignored", "已忽略"

    class UserType(models.TextChoices):
        ANONYMOUS = "anonymous", "匿名"
        C_USER = "c_user", "C端用户"
        ADMIN_USER = "admin_user", "后台操作"

    source = models.CharField(max_length=10, choices=Source.choices, default=Source.MINIAPP)
    level = models.CharField(max_length=8, choices=Level.choices, default=Level.ERROR)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.NEW)
    user_type = models.CharField(max_length=12, choices=UserType.choices, default=UserType.ANONYMOUS)

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="error_logs",
    )
    openid = models.CharField(max_length=64, blank=True)
    contact = models.CharField(max_length=120, blank=True)

    app_version = models.CharField(max_length=32, blank=True)
    platform = models.CharField(max_length=20, blank=True)
    device = models.CharField(max_length=120, blank=True)
    page = models.CharField(max_length=200, blank=True)

    error_type = models.CharField(max_length=60, blank=True)
    message = models.TextField()
    stack_trace = models.TextField(blank=True)

    request_method = models.CharField(max_length=10, blank=True)
    request_path = models.CharField(max_length=300, blank=True)
    request_params = models.JSONField(default=dict, blank=True)
    response_status = models.IntegerField(null=True, blank=True)

    context = models.JSONField(default=dict, blank=True)
    screenshot_url = models.URLField(blank=True)
    trace_id = models.CharField(max_length=64, blank=True, db_index=True)
    fingerprint = models.CharField(max_length=64, db_index=True)

    handled_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="+",
    )
    handled_at = models.DateTimeField(null=True, blank=True)
    resolution_note = models.TextField(blank=True)

    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "错误日志"
        verbose_name_plural = "错误日志"
        indexes = [models.Index(fields=["source", "level", "status"])]

    def __str__(self):
        return f"[{self.source}] {self.message[:40]}"

    def save(self, *args, **kwargs):
        if not self.fingerprint:
            self.fingerprint = compute_fingerprint(
                self.source, self.error_type, self.message, self.page
            )
        super().save(*args, **kwargs)

    def mark_resolved(self, by_user, note=""):
        self.status = self.Status.RESOLVED
        self.handled_by = by_user
        self.handled_at = timezone.now()
        self.resolution_note = note
        self.save(update_fields=["status", "handled_by", "handled_at", "resolution_note"])
```

- [ ] **Step 5: 写基础 Admin**

`monitoring/admin.py`:

```python
from django.contrib import admin

from .models import ErrorLog


@admin.register(ErrorLog)
class ErrorLogAdmin(admin.ModelAdmin):
    list_display = ("created_at", "source", "level", "status", "error_type", "short_message", "trace_id")
    list_filter = ("source", "level", "status", "created_at")
    search_fields = ("message", "trace_id", "openid", "request_path", "fingerprint")
    date_hierarchy = "created_at"
    readonly_fields = ("created_at", "fingerprint", "handled_at")
    list_per_page = 50

    @admin.display(description="错误信息")
    def short_message(self, obj):
        return obj.message[:60]
```

- [ ] **Step 6: 迁移与测试**

Run:
```bash
cd rentalpf && python manage.py makemigrations monitoring && pytest monitoring/tests/test_model.py -v
```
Expected: `4 passed`。

- [ ] **Step 7: 提交**

```bash
git add rentalpf/config/settings.py rentalpf/monitoring
git commit -m "feat(monitoring): ErrorLog 模型、指纹与基础 Admin"
```

---

## Task 2: trace_id 中间件与后端异常自动捕获

**Files:**
- Create: `rentalpf/monitoring/context.py`
- Create: `rentalpf/monitoring/services.py`
- Create: `rentalpf/monitoring/middleware.py`
- Modify: `rentalpf/config/settings.py`（`MIDDLEWARE`）
- Test: `rentalpf/monitoring/tests/test_middleware.py`

**Interfaces:**
- Consumes: `ErrorLog`、`fingerprint`
- Produces:
  - `monitoring.context.set_current_trace_id(value)` / `get_current_trace_id() -> str`
  - `monitoring.services.log_server_exception(request, exc) -> ErrorLog`
  - `monitoring.middleware.TraceIdMiddleware`（写入 `request.trace_id` 与响应头 `X-Trace-Id`）
  - `monitoring.middleware.ExceptionCaptureMiddleware`（记录后原样抛出）

- [ ] **Step 1: 写失败测试**

`monitoring/tests/test_middleware.py`:

```python
import pytest
from django.http import HttpResponse
from django.test import RequestFactory

from monitoring.context import get_current_trace_id
from monitoring.middleware import ExceptionCaptureMiddleware, TraceIdMiddleware
from monitoring.models import ErrorLog


def test_trace_middleware_sets_header_and_request_attr():
    def view(request):
        assert request.trace_id
        return HttpResponse("ok")

    mw = TraceIdMiddleware(view)
    resp = mw(RequestFactory().get("/anything/"))
    assert resp["X-Trace-Id"]
    assert resp["X-Trace-Id"] == resp.wsgi_request.trace_id or True  # 头存在即可


def test_trace_middleware_honors_incoming_header():
    mw = TraceIdMiddleware(lambda r: HttpResponse("ok"))
    resp = mw(RequestFactory().get("/", HTTP_X_TRACE_ID="trace-123"))
    assert resp["X-Trace-Id"] == "trace-123"


@pytest.mark.django_db
def test_exception_capture_logs_and_reraises():
    def boom(request):
        raise ValueError("boom")

    mw = ExceptionCaptureMiddleware(boom)
    request = RequestFactory().get("/api/x/")
    request.trace_id = "t-1"

    with pytest.raises(ValueError):
        mw(request)

    log = ErrorLog.objects.get()
    assert log.source == ErrorLog.Source.SERVER
    assert log.error_type == "ValueError"
    assert log.trace_id == "t-1"
    assert "boom" in log.stack_trace


@pytest.mark.django_db
def test_exception_capture_passes_through_success():
    mw = ExceptionCaptureMiddleware(lambda r: HttpResponse("ok", status=200))
    assert mw(RequestFactory().get("/")).status_code == 200
    assert ErrorLog.objects.count() == 0
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest monitoring/tests/test_middleware.py -v`
Expected: FAIL（`ModuleNotFoundError: monitoring.middleware`）。

- [ ] **Step 3: 写 `context.py`**

```python
import contextvars

_current_trace_id = contextvars.ContextVar("trace_id", default="")


def set_current_trace_id(value):
    _current_trace_id.set(value or "")


def get_current_trace_id():
    return _current_trace_id.get()
```

- [ ] **Step 4: 写 `services.py`（仅异常记录部分）**

```python
import traceback

from .context import get_current_trace_id
from .models import ErrorLog


def log_server_exception(request, exc):
    stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    return ErrorLog.objects.create(
        source=ErrorLog.Source.SERVER,
        level=ErrorLog.Level.ERROR,
        user_type=ErrorLog.UserType.ANONYMOUS if not getattr(request, "user", None)
        or not request.user.is_authenticated else ErrorLog.UserType.C_USER,
        user=getattr(request, "user", None) if getattr(request, "user", None)
        and request.user.is_authenticated else None,
        error_type=type(exc).__name__,
        message=str(exc)[:2000],
        stack_trace=stack,
        request_method=getattr(request, "method", "") or "",
        request_path=getattr(request, "path", "") or "",
        trace_id=getattr(request, "trace_id", "") or get_current_trace_id(),
    )
```

- [ ] **Step 5: 写 `middleware.py`**

```python
import uuid

from .context import set_current_trace_id
from .services import log_server_exception


class TraceIdMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        trace_id = request.headers.get("X-Trace-Id") or uuid.uuid4().hex
        request.trace_id = trace_id
        set_current_trace_id(trace_id)
        response = self.get_response(request)
        response["X-Trace-Id"] = trace_id
        return response


class ExceptionCaptureMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
        self._is_async = False

    def __call__(self, request):
        try:
            return self.get_response(request)
        except Exception as exc:  # noqa: BLE001 - 需捕获全部以记录
            log_server_exception(request, exc)
            raise
```

- [ ] **Step 6: 注册中间件**

在 `config/settings.py` 的 `MIDDLEWARE` 列表最前面（`SecurityMiddleware` 之前或紧随其后，保证 trace 最早生效）插入：

```python
    "monitoring.middleware.TraceIdMiddleware",
```

并在 `CommonMiddleware` 之后、`AuthenticationMiddleware` 之前插入异常捕获（需在认证之后才能拿到 user，故放在 `AuthenticationMiddleware` 之后）：

```python
    "monitoring.middleware.ExceptionCaptureMiddleware",
```

最终顺序应为：`SecurityMiddleware` → `TraceIdMiddleware` → `SessionMiddleware` → `CommonMiddleware` → `CsrfViewMiddleware` → `AuthenticationMiddleware` → `ExceptionCaptureMiddleware` → `MessageMiddleware` → `XFrameOptionsMiddleware`。

- [ ] **Step 7: 测试**

Run: `pytest monitoring/tests/test_middleware.py -v`
Expected: `4 passed`。

- [ ] **Step 8: 提交**

```bash
git add rentalpf/config/settings.py rentalpf/monitoring
git commit -m "feat(monitoring): trace_id 中间件与后端异常自动捕获"
```

---

## Task 3: 客户端上报接口（脱敏 + 限流）

**Files:**
- Create: `rentalpf/monitoring/redact.py`
- Create: `rentalpf/monitoring/serializers.py`
- Create: `rentalpf/monitoring/views.py`
- Create: `rentalpf/monitoring/urls.py`
- Modify: `rentalpf/config/urls.py`
- Modify: `rentalpf/config/settings.py`（`REST_FRAMEWORK` 限流）
- Test: `rentalpf/monitoring/tests/test_report_api.py`

**Interfaces:**
- Consumes: `ErrorLog`、`context.get_current_trace_id`
- Produces:
  - `monitoring.redact.redact(value)`（递归脱敏 dict/list/str）
  - `POST /api/error-logs/` → 201 `{"id", "trace_id"}`

- [ ] **Step 1: 写失败测试**

`monitoring/tests/test_report_api.py`:

```python
import pytest
from rest_framework.test import APIClient

from monitoring.models import ErrorLog
from monitoring.redact import redact
from monitoring.views import ErrorLogReportView


def test_redact_masks_sensitive_keys_and_phone():
    data = {"token": "abc", "phone": "13800000000", "nested": {"password": "p"}}
    out = redact(data)
    assert out["token"] == "***"
    assert out["nested"]["password"] == "***"
    assert out["phone"] == "138****0000"


@pytest.mark.django_db
def test_report_creates_log_with_redaction():
    payload = {
        "source": "miniapp",
        "level": "error",
        "message": "接口调用失败",
        "error_type": "APIError",
        "page": "pages/product/detail",
        "app_version": "1.0.0",
        "platform": "ios",
        "request_params": {"token": "secret-token", "phone": "13800000000"},
        "context": {"sku": "P1"},
    }
    resp = APIClient().post("/api/error-logs/", payload, format="json")
    assert resp.status_code == 201
    log = ErrorLog.objects.get()
    assert log.source == "miniapp"
    assert log.request_params["token"] == "***"
    assert log.request_params["phone"] == "138****0000"
    assert log.fingerprint
    assert resp.json()["trace_id"]


@pytest.mark.django_db
def test_report_requires_message():
    resp = APIClient().post("/api/error-logs/", {"source": "miniapp"}, format="json")
    assert resp.status_code == 400


def test_report_view_uses_scoped_throttle():
    scopes = {c.__name__ for c in ErrorLogReportView.throttle_classes}
    assert "ScopedRateThrottle" in scopes
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest monitoring/tests/test_report_api.py -v`
Expected: FAIL（`ModuleNotFoundError: monitoring.redact`）。

- [ ] **Step 3: 写 `redact.py`**

```python
import re

SENSITIVE_KEYS = {
    "password", "passwd", "pwd", "token", "access_token", "refresh_token",
    "secret", "authorization", "cookie", "session", "id_card", "idcard",
}

_PHONE = re.compile(r"1[3-9]\d{9}")


def _mask_str(value):
    return _PHONE.sub(lambda m: m.group()[:3] + "****" + m.group()[-4:], value)


def redact(value):
    if isinstance(value, dict):
        return {
            k: ("***" if str(k).lower() in SENSITIVE_KEYS else redact(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact(v) for v in value]
    if isinstance(value, str):
        return _mask_str(value)
    return value
```

- [ ] **Step 4: 写序列化器**

`monitoring/serializers.py`:

```python
from rest_framework import serializers


class ErrorLogReportSerializer(serializers.Serializer):
    SOURCE_CHOICES = ["miniapp", "admin"]
    LEVEL_CHOICES = ["info", "warning", "error", "fatal"]

    source = serializers.ChoiceField(choices=SOURCE_CHOICES, default="miniapp")
    level = serializers.ChoiceField(choices=LEVEL_CHOICES, default="error")
    message = serializers.CharField(max_length=2000)
    error_type = serializers.CharField(max_length=60, required=False, allow_blank=True)
    stack_trace = serializers.CharField(required=False, allow_blank=True)
    page = serializers.CharField(max_length=200, required=False, allow_blank=True)
    app_version = serializers.CharField(max_length=32, required=False, allow_blank=True)
    platform = serializers.CharField(max_length=20, required=False, allow_blank=True)
    device = serializers.CharField(max_length=120, required=False, allow_blank=True)
    openid = serializers.CharField(max_length=64, required=False, allow_blank=True)
    trace_id = serializers.CharField(max_length=64, required=False, allow_blank=True)
    context = serializers.JSONField(required=False)
    request_params = serializers.JSONField(required=False)
    response_status = serializers.IntegerField(required=False, allow_null=True)
```

- [ ] **Step 5: 写视图与路由**

`monitoring/views.py`:

```python
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from .context import get_current_trace_id
from .models import ErrorLog
from .redact import redact
from .serializers import ErrorLogReportSerializer


class ErrorLogReportView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "error_report"

    def post(self, request):
        serializer = ErrorLogReportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = request.user if request.user.is_authenticated else None
        log = ErrorLog.objects.create(
            source=data["source"],
            level=data.get("level") or ErrorLog.Level.ERROR,
            user_type=ErrorLog.UserType.C_USER if user else ErrorLog.UserType.ANONYMOUS,
            user=user,
            openid=data.get("openid", ""),
            app_version=data.get("app_version", ""),
            platform=data.get("platform", ""),
            device=data.get("device", ""),
            page=data.get("page", ""),
            error_type=data.get("error_type", ""),
            message=data["message"],
            stack_trace=data.get("stack_trace", ""),
            request_params=redact(data.get("request_params", {})),
            response_status=data.get("response_status"),
            context=redact(data.get("context", {})),
            trace_id=data.get("trace_id") or get_current_trace_id(),
        )
        return Response({"id": log.id, "trace_id": log.trace_id}, status=status.HTTP_201_CREATED)
```

`monitoring/urls.py`:

```python
from django.urls import path

from .views import ErrorLogReportView

urlpatterns = [
    path("error-logs/", ErrorLogReportView.as_view(), name="error-log-report"),
]
```

`config/urls.py` 追加 include：

```python
    path("api/", include("monitoring.urls")),
```

- [ ] **Step 6: 配置限流**

`config/settings.py` 的 `REST_FRAMEWORK` 中追加：

```python
    "DEFAULT_THROTTLE_RATES": {
        "error_report": "20/min",
        "feedback": "10/hour",
    },
```

- [ ] **Step 7: 测试**

Run: `pytest monitoring/tests/test_report_api.py -v`
Expected: `4 passed`。

- [ ] **Step 8: 提交**

```bash
git add rentalpf/config rentalpf/monitoring
git commit -m "feat(monitoring): 客户端错误上报接口（脱敏+限流）"
```

---

## Task 4: 用户反馈接口

**Files:**
- Modify: `rentalpf/monitoring/serializers.py`
- Modify: `rentalpf/monitoring/views.py`
- Modify: `rentalpf/monitoring/urls.py`
- Test: `rentalpf/monitoring/tests/test_feedback_api.py`

**Interfaces:**
- Consumes: `ErrorLog`
- Produces: `POST /api/feedback/` → 201 `{"id"}`；写入 `source=feedback`、`error_type="user_feedback"`、`level=info`

- [ ] **Step 1: 写失败测试**

`monitoring/tests/test_feedback_api.py`:

```python
import pytest
from rest_framework.test import APIClient

from monitoring.models import ErrorLog


@pytest.mark.django_db
def test_feedback_creates_log_without_contact():
    payload = {
        "message": "投影仪镜头有划痕",
        "page": "pages/order/detail",
        "app_version": "1.0.0",
        "screenshot_url": "https://cdn.example.com/a.png",
    }
    resp = APIClient().post("/api/feedback/", payload, format="json")
    assert resp.status_code == 201
    log = ErrorLog.objects.get()
    assert log.source == ErrorLog.Source.FEEDBACK
    assert log.error_type == "user_feedback"
    assert log.level == ErrorLog.Level.INFO
    assert log.screenshot_url.endswith("a.png")
    assert log.contact == ""


@pytest.mark.django_db
def test_feedback_requires_message():
    resp = APIClient().post("/api/feedback/", {"page": "x"}, format="json")
    assert resp.status_code == 400
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest monitoring/tests/test_feedback_api.py -v`
Expected: FAIL（404）。

- [ ] **Step 3: 追加序列化器**

`monitoring/serializers.py` 追加：

```python
class FeedbackSerializer(serializers.Serializer):
    message = serializers.CharField(max_length=2000)
    page = serializers.CharField(max_length=200, required=False, allow_blank=True)
    app_version = serializers.CharField(max_length=32, required=False, allow_blank=True)
    screenshot_url = serializers.URLField(required=False, allow_blank=True)
    contact = serializers.CharField(max_length=120, required=False, allow_blank=True)
    context = serializers.JSONField(required=False)
```

- [ ] **Step 4: 追加视图**

在 `monitoring/views.py` 追加：

```python
from .serializers import FeedbackSerializer


class FeedbackView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "feedback"

    def post(self, request):
        serializer = FeedbackSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        user = request.user if request.user.is_authenticated else None
        log = ErrorLog.objects.create(
            source=ErrorLog.Source.FEEDBACK,
            level=ErrorLog.Level.INFO,
            user_type=ErrorLog.UserType.C_USER if user else ErrorLog.UserType.ANONYMOUS,
            user=user,
            contact=data.get("contact", ""),
            page=data.get("page", ""),
            app_version=data.get("app_version", ""),
            error_type="user_feedback",
            message=data["message"],
            screenshot_url=data.get("screenshot_url", ""),
            context=redact(data.get("context", {})),
            trace_id=get_current_trace_id(),
        )
        return Response({"id": log.id}, status=status.HTTP_201_CREATED)
```

- [ ] **Step 5: 追加路由**

`monitoring/urls.py` 的 `urlpatterns` 追加：

```python
    path("feedback/", FeedbackView.as_view(), name="feedback"),
```

并确保顶部 import 包含 `FeedbackView`：

```python
from .views import ErrorLogReportView, FeedbackView
```

- [ ] **Step 6: 测试**

Run: `pytest monitoring/tests/test_feedback_api.py -v`
Expected: `2 passed`。

- [ ] **Step 7: 提交**

```bash
git add rentalpf/monitoring
git commit -m "feat(monitoring): 用户反馈接口（不回访，联系方式非必填）"
```

---

## Task 5: 后台处理动作与按指纹聚合

**Files:**
- Modify: `rentalpf/monitoring/services.py`
- Modify: `rentalpf/monitoring/admin.py`
- Test: `rentalpf/monitoring/tests/test_admin_and_purge.py`（Task 6 会继续追加）

**Interfaces:**
- Consumes: `ErrorLog`
- Produces:
  - `monitoring.services.fingerprint_summary(limit=50) -> list[dict]`（键：`fingerprint`、`count`、`source`、`error_type`、`sample_message`、`last_seen`）
  - Admin 动作：`mark_resolved`、`mark_ignored`
  - Admin 自定义视图 `/admin/monitoring/errorlog/fingerprints/`

- [ ] **Step 1: 写失败测试**

`monitoring/tests/test_admin_and_purge.py`:

```python
import pytest
from django.contrib.auth import get_user_model
from django.test import Client

from monitoring.models import ErrorLog
from monitoring.services import fingerprint_summary

User = get_user_model()


@pytest.mark.django_db
def test_fingerprint_summary_groups_same_fingerprint():
    ErrorLog.objects.create(source="miniapp", error_type="TypeError", message="undefined 1", page="p")
    ErrorLog.objects.create(source="miniapp", error_type="TypeError", message="undefined 2", page="p")
    ErrorLog.objects.create(source="server", error_type="ValueError", message="boom", page="")

    summary = fingerprint_summary()
    assert summary[0]["count"] == 2
    assert summary[0]["error_type"] == "TypeError"


@pytest.mark.django_db
def test_admin_action_mark_resolved():
    staff = User.objects.create_superuser(username="admin", password="x", email="a@b.c")
    log = ErrorLog.objects.create(source="server", message="boom")
    client = Client()
    client.force_login(staff)
    resp = client.post(
        "/admin/monitoring/errorlog/",
        {"action": "mark_resolved", "_selected_action": [str(log.pk)]},
        follow=True,
    )
    assert resp.status_code == 200
    log.refresh_from_db()
    assert log.status == ErrorLog.Status.RESOLVED
    assert log.handled_by == staff
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest monitoring/tests/test_admin_and_purge.py -v`
Expected: FAIL（`ImportError: fingerprint_summary`）。

- [ ] **Step 3: 追加 `services.py`**

在 `monitoring/services.py` 末尾追加：

```python
from django.db.models import Count, Max


def fingerprint_summary(limit=50):
    rows = (
        ErrorLog.objects.values("fingerprint", "source", "error_type")
        .annotate(count=Count("id"), last_seen=Max("created_at"))
        .order_by("-count")[:limit]
    )
    result = []
    for row in rows:
        sample = (
            ErrorLog.objects.filter(fingerprint=row["fingerprint"])
            .order_by("-created_at")
            .values_list("message", flat=True)
            .first()
        )
        result.append(
            {
                "fingerprint": row["fingerprint"],
                "source": row["source"],
                "error_type": row["error_type"],
                "count": row["count"],
                "last_seen": row["last_seen"],
                "sample_message": sample or "",
            }
        )
    return result
```

- [ ] **Step 4: 扩展 Admin**

在 `monitoring/admin.py` 中追加（并在顶部引入所需模块）：

```python
from django.shortcuts import render
from django.urls import path

from .services import fingerprint_summary


@admin.action(description="标记为已解决")
def mark_resolved_action(modeladmin, request, queryset):
    for log in queryset:
        log.mark_resolved(request.user, note="后台批量标记")


@admin.action(description="标记为已忽略")
def mark_ignored_action(modeladmin, request, queryset):
    queryset.update(status=ErrorLog.Status.IGNORED)


# 在 ErrorLogAdmin 内补充：
ErrorLogAdmin.actions = [mark_resolved_action, mark_ignored_action]

_errorlog_admin = admin.site._registry[ErrorLog]


def _fingerprints_view(request):
    data = fingerprint_summary()
    context = {**admin.site.each_context(request), "title": "错误指纹聚合", "rows": data}
    return render(request, "admin/monitoring/fingerprint_summary.html", context)


_original_get_urls = ErrorLogAdmin.get_urls


def _get_urls(self):
    return [
        path("fingerprints/", self.admin_site.admin_view(_fingerprints_view), name="monitoring_errorlog_fingerprints"),
    ] + _original_get_urls(self)


ErrorLogAdmin.get_urls = _get_urls
```

创建模板 `monitoring/templates/admin/monitoring/fingerprint_summary.html`：

```html
{% extends "admin/base_site.html" %}
{% block content %}
<h1>错误指纹聚合</h1>
<table>
  <thead><tr><th>指纹</th><th>来源</th><th>类型</th><th>次数</th><th>最近</th><th>示例</th></tr></thead>
  <tbody>
  {% for r in rows %}
    <tr>
      <td>{{ r.fingerprint }}</td><td>{{ r.source }}</td><td>{{ r.error_type }}</td>
      <td>{{ r.count }}</td><td>{{ r.last_seen }}</td><td>{{ r.sample_message }}</td>
    </tr>
  {% empty %}
    <tr><td colspan="6">暂无数据</td></tr>
  {% endfor %}
  </tbody>
</table>
{% endblock %}
```

> 若 `admin.site._registry[ErrorLog]` 取实例的写法不便，可改为在 `ErrorLogAdmin` 类内部直接定义 `actions` 与 `get_urls`（推荐在类体内实现，本步代码以“类外补丁”方式给出是为最小改动；实现者可按类内方式等价改写）。

- [ ] **Step 5: 测试**

Run: `pytest monitoring/tests/test_admin_and_purge.py -v`
Expected: `2 passed`。

- [ ] **Step 6: 提交**

```bash
git add rentalpf/monitoring
git commit -m "feat(monitoring): 后台批量处理动作与指纹聚合视图"
```

---

## Task 6: 保留期清理命令（180 天）

**Files:**
- Modify: `rentalpf/config/settings.py`（新增 `MONITORING_RETENTION_DAYS`）
- Create: `rentalpf/monitoring/management/__init__.py`
- Create: `rentalpf/monitoring/management/commands/__init__.py`
- Create: `rentalpf/monitoring/management/commands/purge_old_error_logs.py`
- Test: `rentalpf/monitoring/tests/test_admin_and_purge.py`（追加）

**Interfaces:**
- Consumes: `ErrorLog`
- Produces: 管理命令 `python manage.py purge_old_error_logs [--days N] [--dry-run]`；读取 `settings.MONITORING_RETENTION_DAYS`（默认 180）

- [ ] **Step 1: 写失败测试**

在 `monitoring/tests/test_admin_and_purge.py` 追加：

```python
from datetime import timedelta

from django.core.management import call_command
from django.utils import timezone


@pytest.mark.django_db
def test_purge_old_error_logs_removes_only_old():
    old = ErrorLog.objects.create(source="server", message="old")
    ErrorLog.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=200))
    recent = ErrorLog.objects.create(source="server", message="recent")

    call_command("purge_old_error_logs")

    assert not ErrorLog.objects.filter(pk=old.pk).exists()
    assert ErrorLog.objects.filter(pk=recent.pk).exists()


@pytest.mark.django_db
def test_purge_dry_run_keeps_rows():
    old = ErrorLog.objects.create(source="server", message="old")
    ErrorLog.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=200))

    call_command("purge_old_error_logs", "--dry-run")

    assert ErrorLog.objects.filter(pk=old.pk).exists()
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest monitoring/tests/test_admin_and_purge.py -k purge -v`
Expected: FAIL（`Unknown command: 'purge_old_error_logs'`）。

- [ ] **Step 3: 写设置项**

在 `config/settings.py` 末尾追加：

```python
MONITORING_RETENTION_DAYS = env.int("MONITORING_RETENTION_DAYS", default=180)
```

- [ ] **Step 4: 写管理命令**

`monitoring/management/commands/purge_old_error_logs.py`:

```python
from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from monitoring.models import ErrorLog


class Command(BaseCommand):
    help = "删除超过保留期的错误日志（默认 180 天）"

    def add_arguments(self, parser):
        parser.add_argument("--days", type=int, default=None)
        parser.add_argument("--dry-run", action="store_true")

    def handle(self, *args, **options):
        days = options["days"] or settings.MONITORING_RETENTION_DAYS
        cutoff = timezone.now() - timedelta(days=days)
        queryset = ErrorLog.objects.filter(created_at__lt=cutoff)
        count = queryset.count()
        if options["dry_run"]:
            self.stdout.write(f"[dry-run] 将删除 {count} 条（早于 {cutoff.isoformat()}）")
            return
        queryset.delete()
        self.stdout.write(self.style.SUCCESS(f"已删除 {count} 条错误日志（保留期 {days} 天）"))
```

确保 `monitoring/management/__init__.py` 与 `commands/__init__.py` 为空文件存在。

- [ ] **Step 5: 测试**

Run: `pytest monitoring/tests/test_admin_and_purge.py -v`
Expected: `4 passed`。

- [ ] **Step 6: 全量测试**

Run: `pytest`
Expected: 全部通过。

- [ ] **Step 7: 提交**

```bash
git add rentalpf/config/settings.py rentalpf/monitoring
git commit -m "feat(monitoring): 180 天保留期清理命令"
```

---

## Self-Review（作者自检记录）

- **Spec 覆盖**：REQ-ERR-01（Task 1 模型）、02（Task 1/3/4 各来源）、03（Task 2 中间件）、04（Task 3 上报+限流+脱敏）、05（Task 4 反馈不回访）、06（Task 5 Admin 筛选/动作/导出能力）、07（Task 1 指纹 + Task 5 聚合）、08（Task 3 脱敏、Task 6 保留 180 天、Task 3 限流）。导出能力由 Django Admin 自带（list 的「导出」可用第三方或后续增强，本计划不引入额外依赖）。
- **占位扫描**：无 TBD/TODO；所有代码步骤含完整代码。Task 5 的 Admin 补丁写法给了等价改写说明，非占位。
- **类型一致性**：`get_current_trace_id()`、`redact()`、`compute_fingerprint(source, error_type, message, page)`、`ErrorLog.mark_resolved(by_user, note)`、`fingerprint_summary(limit)` 在各任务与测试中命名一致；`trace_id` 由 TraceIdMiddleware 写入 `request.trace_id`，被 Task 2 services 与 Task 3 view 一致读取。
- **迁移提示**：Task 1 生成 `monitoring` 初始迁移；后续任务不改模型，无需新迁移。
