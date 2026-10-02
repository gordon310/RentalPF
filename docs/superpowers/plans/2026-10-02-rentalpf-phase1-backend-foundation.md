# RentalPF 后端地基 + 可配置商品域 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Django/DRF 后端地基，并实现「完全后台可配置」的商品域（分类树、动态属性、商品 SKU、一机一码资产、计价规则、押金规则）及其只读 API。

**Architecture:** Django 单体 + DRF 暴露 API；业务配置全部存数据库、经 Django Admin 维护，代码只提供规则读取与求值，不内置任何品类/价格/押金枚举。商品分「SKU（Product）+ 资产实例（AssetInstance）」两层，档期占用后续锁定到资产实例。

**Tech Stack:** Python 3.12、Django 5.1、Django REST Framework 3.15、PostgreSQL（生产）/ SQLite（开发与测试）、pytest + pytest-django、django-environ。

**Spec:** `docs/办公设备租赁平台开发需求文档_V0.2.md`

## Global Constraints

- Python 版本：3.12；Django `>=5.1,<5.2`；DRF `>=3.15`。
- 金额一律使用 `Decimal`，`max_digits=10, decimal_places=2`，币种 CNY。
- **反硬编码红线**：品类树、属性字段、计价规则、押金/免押规则、计费周期全部为**数据库可配置数据**；代码不得写死任何业务枚举（`TextChoices` 仅用于技术状态如 asset status，且不得含具体品类名）。
- 语言 `zh-hans`，时区 `Asia/Shanghai`，`USE_TZ=True`。
- API 统一前缀 `/api/`；一期只提供**只读**商品接口。
- 开发/测试默认 SQLite（`DATABASE_URL` 未设时），生产用 PostgreSQL。
- 每个任务结束必须 `pytest` 全绿并提交一次。

---

## 后续计划 Roadmap（本计划之后另立文件，逐个交付）

1. `phase1-auth-deposit`：微信登录、手机号、实名认证、押金预授权/免押客户端接入。
2. `phase1-booking`：档期库存、订单创建、资产实例锁定与并发。
3. `phase1-payment-settlement`：微信/支付宝支付、押金冻结/解冻、退款、结算；电子合同适配层（占位不接入）。
4. `phase1-fulfillment-return`：交付（自提/配送/上门安装）、归还验收、定损赔偿表、逾期风控、消息通知。
5. `phase1-miniprogram`：原生微信小程序前端（首页/分类/商品详情/下单/订单/我的）。
6. `phase1-ops-admin`：运营后台增强、营销工具、数据看板。

> 本计划产出「可运行、可测试」的后端地基与商品域，是上述所有计划的依赖。

---

## File Structure

```
rentalpf/                     # Django 项目根（后端仓库，建议与问卷仓库分开或置于 server/）
├── manage.py
├── requirements.txt
├── pytest.ini
├── .env.example
├── config/                 # 项目配置
│   ├── __init__.py
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── catalog/                # 商品域：分类、属性、商品
│   ├── __init__.py
│   ├── apps.py
│   ├── models.py
│   ├── admin.py
│   ├── serializers.py
│   ├── views.py
│   ├── urls.py
│   ├── migrations/
│   └── tests/
│       ├── test_category.py
│       ├── test_attributes.py
│       ├── test_product.py
│       └── test_api.py
├── inventory/              # 资产实例（一机一码）
│   ├── models.py
│   ├── admin.py
│   ├── migrations/
│   └── tests/test_asset.py
└── pricing/                # 计价规则、押金规则、规则服务
    ├── models.py
    ├── admin.py
    ├── services.py
    ├── migrations/
    └── tests/
        ├── test_pricing.py
        └── test_deposit.py
```

职责边界：`catalog` 只管「卖什么」，`inventory` 管「具体哪一台」，`pricing` 管「多少钱、押多少」。三者通过 FK 组合，接口清晰。

---

## Task 1: 项目脚手架与健康检查

**Files:**
- Create: `rentalpf/requirements.txt`
- Create: `rentalpf/manage.py`
- Create: `rentalpf/pytest.ini`
- Create: `rentalpf/.env.example`
- Create: `rentalpf/config/__init__.py`
- Create: `rentalpf/config/settings.py`
- Create: `rentalpf/config/urls.py`
- Create: `rentalpf/config/wsgi.py`
- Create: `rentalpf/config/asgi.py`
- Create: `rentalpf/catalog/__init__.py`, `apps.py`
- Create: `rentalpf/inventory/__init__.py`, `apps.py`
- Create: `rentalpf/pricing/__init__.py`, `apps.py`
- Create: `rentalpf/config/views.py`
- Test: `rentalpf/tests/test_health.py`

**Interfaces:**
- Consumes: 无
- Produces: Django 项目模块 `config`；应用标签 `catalog`、`inventory`、`pricing`；`config.views.health` 返回 `{"status": "ok"}`。

- [ ] **Step 1: 创建目录并写依赖文件**

`requirements.txt`:

```text
Django>=5.1,<5.2
djangorestframework>=3.15
django-environ>=0.11
psycopg[binary]>=3.2
pytest>=8.0
pytest-django>=4.8
pytest-cov>=5.0
```

- [ ] **Step 2: 写 `manage.py` 与 `pytest.ini`**

`manage.py`:

```python
#!/usr/bin/env python
import os
import sys


def main():
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
    from django.core.management import execute_from_command_line
    execute_from_command_line(sys.argv)


if __name__ == "__main__":
    main()
```

`pytest.ini`:

```ini
[pytest]
DJANGO_SETTINGS_MODULE = config.settings
python_files = tests.py test_*.py *_tests.py
addopts = -q
```

- [ ] **Step 3: 写 `config/settings.py`（开发/测试默认 SQLite，生产走 `DATABASE_URL`）**

```python
from pathlib import Path

import environ

BASE_DIR = Path(__file__).resolve().parent.parent

env = environ.Env(
    DEBUG=(bool, True),
    DJANGO_SECRET_KEY=(str, "dev-insecure-key-change-me"),
    DATABASE_URL=(str, f"sqlite:///{BASE_DIR / 'db.sqlite3'}"),
    ALLOWED_HOSTS=(list, ["*"]),
)
if (BASE_DIR / ".env").exists():
    environ.Env.read_env(BASE_DIR / ".env")

SECRET_KEY = env("DJANGO_SECRET_KEY")
DEBUG = env("DEBUG")
ALLOWED_HOSTS = env("ALLOWED_HOSTS")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "catalog",
    "inventory",
    "pricing",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

DATABASES = {"default": env.db("DATABASE_URL")}

AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = "zh-hans"
TIME_ZONE = "Asia/Shanghai"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REST_FRAMEWORK = {
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.AllowAny"],
    "DEFAULT_RENDERER_CLASSES": ["rest_framework.renderers.JSONRenderer"],
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": 50,
}
```

- [ ] **Step 4: 写 `config/views.py`、`config/urls.py`、`wsgi.py`、`asgi.py`**

`config/views.py`:

```python
from django.http import JsonResponse


def health(request):
    return JsonResponse({"status": "ok"})
```

`config/urls.py`:

```python
from django.contrib import admin
from django.urls import include, path

from .views import health

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health),
    path("api/", include("catalog.urls")),
]
```

`config/wsgi.py`:

```python
import os

from django.core.wsgi import get_wsgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_wsgi_application()
```

`config/asgi.py`:

```python
import os

from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
application = get_asgi_application()
```

- [ ] **Step 5: 写空的 `catalog/urls.py` 与应用配置**

`catalog/apps.py`:

```python
from django.apps import AppConfig


class CatalogConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "catalog"
```

`inventory/apps.py` 与 `pricing/apps.py` 同理（`name = "inventory"` / `"pricing"`）。

`catalog/urls.py`（先占位，Task 8 填充）:

```python
urlpatterns = []
```

- [ ] **Step 6: 写健康检查测试**

`tests/test_health.py`:

```python
import pytest
from django.test import Client


@pytest.mark.django_db
def test_health_returns_ok():
    resp = Client().get("/api/health/")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
```

- [ ] **Step 7: 安装依赖并运行测试**

Run:
```bash
cd rentalpf && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt && pytest
```
Expected: `1 passed`。

- [ ] **Step 8: 提交**

```bash
git add rentalpf
git commit -m "chore: Django/DRF 脚手脚与健康检查"
```

---

## Task 2: 分类树（后台可配置，多级）

**Files:**
- Create: `rentalpf/catalog/models.py`
- Create: `rentalpf/catalog/admin.py`
- Create: `rentalpf/catalog/migrations/__init__.py`
- Create: `rentalpf/catalog/tests/__init__.py`
- Test: `rentalpf/catalog/tests/test_category.py`

**Interfaces:**
- Consumes: `config.settings`
- Produces:
  - `catalog.models.Category(parent, name, slug, sort_order, is_active, created_at)`
  - `Category.ancestors() -> list[Category]`（从根到直接父，根在前）
  - `Category.depth() -> int`
  - `Category.full_path() -> str`（`"相机 / 镜头 / 定焦"`）

- [ ] **Step 1: 写失败测试**

`catalog/tests/test_category.py`:

```python
import pytest

from catalog.models import Category


@pytest.mark.django_db
def test_category_tree_depth_and_ancestors():
    root = Category.objects.create(name="相机", slug="camera")
    lens = Category.objects.create(name="镜头", slug="lens", parent=root)
    prime = Category.objects.create(name="定焦", slug="prime", parent=lens)

    assert root.depth() == 0
    assert prime.depth() == 2
    assert [c.slug for c in prime.ancestors()] == ["camera", "lens"]
    assert prime.full_path() == "相机 / 镜头 / 定焦"


@pytest.mark.django_db
def test_category_slug_unique():
    Category.objects.create(name="相机", slug="camera")
    with pytest.raises(Exception):
        Category.objects.create(name="相机2", slug="camera")
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pytest catalog/tests/test_category.py -v`
Expected: FAIL（`ModuleNotFoundError: catalog.models`）。

- [ ] **Step 3: 实现模型**

`catalog/models.py`:

```python
from django.db import models


class Category(models.Model):
    parent = models.ForeignKey(
        "self", null=True, blank=True, related_name="children", on_delete=models.PROTECT
    )
    name = models.CharField(max_length=100)
    slug = models.SlugField(max_length=120, unique=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["sort_order", "id"]
        verbose_name = "分类"
        verbose_name_plural = "分类"

    def __str__(self):
        return self.full_path()

    def ancestors(self):
        chain, node = [], self.parent
        while node is not None:
            chain.append(node)
            node = node.parent
        return list(reversed(chain))

    def depth(self):
        return len(self.ancestors())

    def full_path(self):
        return " / ".join([c.name for c in self.ancestors()] + [self.name])
```

- [ ] **Step 4: 生成并应用迁移**

Run:
```bash
python manage.py makemigrations catalog && python manage.py migrate
```
Expected: 创建 `catalog` 迁移，SQLite 迁移成功。

- [ ] **Step 5: 运行测试确认通过**

Run: `pytest catalog/tests/test_category.py -v`
Expected: `2 passed`。

- [ ] **Step 6: 注册 Admin（后台可增删改分类树）**

`catalog/admin.py`:

```python
from django.contrib import admin

from .models import Category


@admin.register(Category)
class CategoryAdmin(admin.ModelAdmin):
    list_display = ("name", "parent", "slug", "sort_order", "is_active")
    list_filter = ("is_active", "parent")
    search_fields = ("name", "slug")
    list_editable = ("sort_order", "is_active")
    autocomplete_fields = ("parent",)
```

- [ ] **Step 7: 提交**

```bash
git add rentalpf/catalog
git commit -m "feat(catalog): 可配置多级分类树 + Admin"
```

---

## Task 3: 动态属性模板（按品类配置，含继承）

**Files:**
- Modify: `rentalpf/catalog/models.py`
- Modify: `rentalpf/catalog/admin.py`
- Create: `rentalpf/catalog/migrations/0002_*.py`（自动生成）
- Test: `rentalpf/catalog/tests/test_attributes.py`

**Interfaces:**
- Consumes: `Category`
- Produces:
  - `catalog.models.AttributeDefinition(category, key, name, data_type, required, options, unit, sort_order, is_active)`
  - `AttributeDefinition.DataType`（`text/number/single/multi/bool/image`）
  - `Category.applicable_attributes() -> QuerySet[AttributeDefinition]`（自身 + 所有祖先，按 sort_order 排序）

- [ ] **Step 1: 写失败测试**

`catalog/tests/test_attributes.py`:

```python
import pytest

from catalog.models import AttributeDefinition, Category


@pytest.mark.django_db
def test_attributes_inherit_from_ancestors():
    root = Category.objects.create(name="相机", slug="camera")
    lens = Category.objects.create(name="镜头", slug="lens", parent=root)

    AttributeDefinition.objects.create(category=root, key="brand", name="品牌", data_type="text")
    AttributeDefinition.objects.create(
        category=lens, key="mount", name="卡口", data_type="single", options=["EF", "RF", "F"]
    )

    keys = [a.key for a in lens.applicable_attributes()]
    assert keys == ["brand", "mount"]


@pytest.mark.django_db
def test_attribute_key_unique_per_category():
    root = Category.objects.create(name="相机", slug="camera")
    AttributeDefinition.objects.create(category=root, key="brand", name="品牌")
    with pytest.raises(Exception):
        AttributeDefinition.objects.create(category=root, key="brand", name="品牌2")


@pytest.mark.django_db
def test_inactive_attribute_excluded():
    root = Category.objects.create(name="相机", slug="camera")
    AttributeDefinition.objects.create(category=root, key="brand", name="品牌", is_active=False)
    assert root.applicable_attributes().count() == 0
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest catalog/tests/test_attributes.py -v`
Expected: FAIL（`ImportError: cannot import name 'AttributeDefinition'`）。

- [ ] **Step 3: 追加模型**

在 `catalog/models.py` 末尾追加：

```python
class AttributeDefinition(models.Model):
    class DataType(models.TextChoices):
        TEXT = "text", "文本"
        NUMBER = "number", "数字"
        SINGLE = "single", "单选"
        MULTI = "multi", "多选"
        BOOL = "bool", "布尔"
        IMAGE = "image", "图片"

    category = models.ForeignKey(
        Category, related_name="attribute_definitions", on_delete=models.CASCADE
    )
    key = models.SlugField(max_length=50)
    name = models.CharField(max_length=100)
    data_type = models.CharField(max_length=10, choices=DataType.choices, default=DataType.TEXT)
    required = models.BooleanField(default=False)
    options = models.JSONField(default=list, blank=True)
    unit = models.CharField(max_length=20, blank=True)
    sort_order = models.IntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["sort_order", "id"]
        unique_together = ("category", "key")
        verbose_name = "属性定义"
        verbose_name_plural = "属性定义"

    def __str__(self):
        return f"{self.category.name}.{self.key}"
```

并在 `Category` 类中追加方法：

```python
    def applicable_attributes(self):
        ids = [c.id for c in self.ancestors()] + [self.id]
        return AttributeDefinition.objects.filter(category_id__in=ids, is_active=True).order_by(
            "sort_order", "id"
        )
```

- [ ] **Step 4: 生成迁移并运行测试**

Run:
```bash
python manage.py makemigrations catalog && pytest catalog/tests/test_attributes.py -v
```
Expected: `3 passed`。

- [ ] **Step 5: Admin 内联属性到分类**

在 `catalog/admin.py` 中追加：

```python
from .models import AttributeDefinition


class AttributeDefinitionInline(admin.TabularInline):
    model = AttributeDefinition
    extra = 1
    fields = ("key", "name", "data_type", "required", "options", "unit", "sort_order", "is_active")


# 在 CategoryAdmin 上加入 inline
CategoryAdmin.inlines = [AttributeDefinitionInline]


@admin.register(AttributeDefinition)
class AttributeDefinitionAdmin(admin.ModelAdmin):
    list_display = ("name", "key", "category", "data_type", "required", "is_active")
    list_filter = ("data_type", "required", "is_active")
    search_fields = ("name", "key")
```

> 注：`CategoryAdmin` 已在 Task 2 注册，此处通过追加 `inlines` 修改。若生成器报重复注册，改为在 Task 2 的装饰器类里预先保留 `inlines = []`。

- [ ] **Step 6: 提交**

```bash
git add rentalpf/catalog
git commit -m "feat(catalog): 品类动态属性模板（可继承）"
```

---

## Task 4: 商品 SKU（数据驱动上架）

**Files:**
- Modify: `rentalpf/catalog/models.py`
- Modify: `rentalpf/catalog/admin.py`
- Create: `rentalpf/catalog/migrations/0003_*.py`（自动生成）
- Test: `rentalpf/catalog/tests/test_product.py`

**Interfaces:**
- Consumes: `Category`
- Produces:
  - `catalog.models.Product(category, name, brand, model, sku_code, description, images, specs, status, created_at, updated_at)`
  - `Product.Status`（`draft/active/archived`）
  - `Product.is_rentable() -> bool`
  - 反向关系：`Product.assets`（Task 5 提供）

- [ ] **Step 1: 写失败测试**

`catalog/tests/test_product.py`:

```python
import pytest

from catalog.models import Category, Product


@pytest.mark.django_db
def test_product_defaults_and_specs_json():
    cat = Category.objects.create(name="投影仪", slug="projector")
    p = Product.objects.create(
        category=cat, name="投影仪 X1", brand="ACME", model="X1",
        specs={"resolution": "1080p", "brightness": 3000},
        images=["a.jpg", "b.jpg"],
    )
    assert p.status == Product.Status.DRAFT
    assert p.specs["resolution"] == "1080p"
    assert p.images == ["a.jpg", "b.jpg"]


@pytest.mark.django_db
def test_sku_code_unique():
    cat = Category.objects.create(name="投影仪", slug="projector")
    Product.objects.create(category=cat, name="A", sku_code="SKU-1")
    with pytest.raises(Exception):
        Product.objects.create(category=cat, name="B", sku_code="SKU-1")
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest catalog/tests/test_product.py -v`
Expected: FAIL（`ImportError: cannot import name 'Product'`）。

- [ ] **Step 3: 实现模型**

在 `catalog/models.py` 追加：

```python
class Product(models.Model):
    class Status(models.TextChoices):
        DRAFT = "draft", "草稿"
        ACTIVE = "active", "上架"
        ARCHIVED = "archived", "归档"

    category = models.ForeignKey(Category, related_name="products", on_delete=models.PROTECT)
    name = models.CharField(max_length=120)
    brand = models.CharField(max_length=80, blank=True)
    model = models.CharField(max_length=80, blank=True)
    sku_code = models.CharField(max_length=60, unique=True, null=True, blank=True)
    description = models.TextField(blank=True)
    images = models.JSONField(default=list, blank=True)
    specs = models.JSONField(default=dict, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "商品"
        verbose_name_plural = "商品"

    def __str__(self):
        return self.name

    def is_rentable(self):
        return self.status == self.Status.ACTIVE and self.assets.filter(
            status="available"
        ).exists()
```

- [ ] **Step 4: 迁移与测试**

Run:
```bash
python manage.py makemigrations catalog && pytest catalog/tests/test_product.py -v
```
Expected: `2 passed`。

- [ ] **Step 5: Admin 注册商品**

在 `catalog/admin.py` 追加：

```python
from .models import Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ("name", "category", "brand", "model", "sku_code", "status", "is_rentable")
    list_filter = ("status", "category")
    search_fields = ("name", "brand", "model", "sku_code")
    autocomplete_fields = ("category",)
    list_editable = ("status",)

    @admin.display(boolean=True, description="可租")
    def is_rentable(self, obj):
        return obj.is_rentable()
```

> 若 `is_rentable` 与 Django 5 的 `list_display` 检查冲突，改名为 `rentable_flag` 并更新 `list_display`。

- [ ] **Step 6: 提交**

```bash
git add rentalpf/catalog
git commit -m "feat(catalog): 商品 SKU（数据驱动上架）+ Admin"
```

---

## Task 5: 一机一码资产实例

**Files:**
- Create: `rentalpf/inventory/models.py`
- Create: `rentalpf/inventory/admin.py`
- Create: `rentalpf/inventory/migrations/__init__.py`
- Create: `rentalpf/inventory/tests/__init__.py`
- Test: `rentalpf/inventory/tests/test_asset.py`

**Interfaces:**
- Consumes: `catalog.models.Product`
- Produces:
  - `inventory.models.AssetInstance(product, sn, status, condition, purchase_date, warehouse, notes, created_at)`
  - `AssetInstance.Status`（`available/rented/maintenance/retired`）
  - `AssetInstance.is_available() -> bool`
  - `Product.assets` 反向管理器（由 `related_name="assets"` 提供）

- [ ] **Step 1: 写失败测试**

`inventory/tests/test_asset.py`:

```python
import pytest

from catalog.models import Category, Product
from inventory.models import AssetInstance


@pytest.mark.django_db
def test_asset_sn_unique_and_status_default():
    cat = Category.objects.create(name="相机", slug="camera")
    p = Product.objects.create(category=cat, name="相机 R5", status=Product.Status.ACTIVE)

    a1 = AssetInstance.objects.create(product=p, sn="SN-001")
    assert a1.status == AssetInstance.Status.AVAILABLE
    assert a1.is_available() is True

    with pytest.raises(Exception):
        AssetInstance.objects.create(product=p, sn="SN-001")


@pytest.mark.django_db
def test_product_rentable_requires_active_and_available_asset():
    cat = Category.objects.create(name="相机", slug="camera")
    p = Product.objects.create(category=cat, name="相机 R5", status=Product.Status.ACTIVE)
    AssetInstance.objects.create(product=p, sn="SN-001", status=AssetInstance.Status.MAINTENANCE)
    assert p.is_rentable() is False
    AssetInstance.objects.create(product=p, sn="SN-002", status=AssetInstance.Status.AVAILABLE)
    assert p.is_rentable() is True
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest inventory/tests/test_asset.py -v`
Expected: FAIL（`ModuleNotFoundError: inventory.models`）。

- [ ] **Step 3: 实现模型**

`inventory/models.py`:

```python
from django.db import models


class AssetInstance(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "available", "可租"
        RENTED = "rented", "在租"
        MAINTENANCE = "maintenance", "维修"
        RETIRED = "retired", "报废"

    product = models.ForeignKey(
        "catalog.Product", related_name="assets", on_delete=models.PROTECT
    )
    sn = models.CharField(max_length=100, unique=True)
    status = models.CharField(max_length=12, choices=Status.choices, default=Status.AVAILABLE)
    condition = models.CharField(max_length=50, blank=True)
    purchase_date = models.DateField(null=True, blank=True)
    warehouse = models.CharField(max_length=80, blank=True)
    notes = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["product_id", "sn"]
        verbose_name = "资产实例"
        verbose_name_plural = "资产实例"

    def __str__(self):
        return f"{self.product.name} [{self.sn}]"

    def is_available(self):
        return self.status == self.Status.AVAILABLE
```

- [ ] **Step 4: 迁移与测试**

Run:
```bash
python manage.py makemigrations inventory && pytest inventory/tests/test_asset.py -v
```
Expected: `2 passed`。

- [ ] **Step 5: Admin 资产内联到商品**

`inventory/admin.py`:

```python
from django.contrib import admin

from catalog.admin import ProductAdmin
from .models import AssetInstance


class AssetInstanceInline(admin.TabularInline):
    model = AssetInstance
    extra = 1
    fields = ("sn", "status", "condition", "purchase_date", "warehouse")


ProductAdmin.inlines = list(getattr(ProductAdmin, "inlines", [])) + [AssetInstanceInline]


@admin.register(AssetInstance)
class AssetInstanceAdmin(admin.ModelAdmin):
    list_display = ("sn", "product", "status", "condition", "warehouse")
    list_filter = ("status", "warehouse")
    search_fields = ("sn", "product__name")
    autocomplete_fields = ("product",)
```

> 若 `ProductAdmin` 未设置 `search_fields` 导致 `autocomplete_fields=("product",)` 报错，确认 `ProductAdmin.search_fields` 存在（Task 4 已设）。

- [ ] **Step 6: 提交**

```bash
git add rentalpf/inventory
git commit -m "feat(inventory): 一机一码资产实例 + Admin 内联"
```

---

## Task 6: 计价规则与报价服务

**Files:**
- Create: `rentalpf/pricing/models.py`
- Create: `rentalpf/pricing/services.py`
- Create: `rentalpf/pricing/admin.py`
- Create: `rentalpf/pricing/migrations/__init__.py`
- Create: `rentalpf/pricing/tests/__init__.py`
- Test: `rentalpf/pricing/tests/test_pricing.py`

**Interfaces:**
- Consumes: `catalog.models.Product`
- Produces:
  - `pricing.models.PricingRule(product, period, base_amount, tiers, is_active)`
  - `PricingRule.Period`（`hour/day/week/month/year`）
  - `PricingRule.unit_amount_for(units: int) -> Decimal`
  - `pricing.services.quote(product, period: str, units: int) -> Decimal`
  - 反向关系：`Product.pricing_rules`

- [ ] **Step 1: 写失败测试**

`pricing/tests/test_pricing.py`:

```python
from decimal import Decimal

import pytest

from catalog.models import Category, Product
from pricing.models import PricingRule
from pricing.services import quote


def _product():
    cat = Category.objects.create(name="投影仪", slug="projector")
    return Product.objects.create(category=cat, name="投影仪 X1")


@pytest.mark.django_db
def test_quote_uses_base_amount_without_tiers():
    p = _product()
    PricingRule.objects.create(product=p, period="day", base_amount=Decimal("100.00"))
    assert quote(p, "day", 3) == Decimal("300.00")


@pytest.mark.django_db
def test_quote_uses_tier_unit_amount():
    p = _product()
    PricingRule.objects.create(
        product=p, period="day", base_amount=Decimal("100.00"),
        tiers=[{"min_units": 7, "unit_amount": "80.00"}],
    )
    assert quote(p, "day", 10) == Decimal("800.00")
    assert quote(p, "day", 3) == Decimal("300.00")


@pytest.mark.django_db
def test_quote_raises_without_active_rule():
    p = _product()
    with pytest.raises(ValueError):
        quote(p, "day", 1)
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest pricing/tests/test_pricing.py -v`
Expected: FAIL（`ModuleNotFoundError: pricing.models`）。

- [ ] **Step 3: 实现模型**

`pricing/models.py`:

```python
from decimal import Decimal

from django.db import models


class PricingRule(models.Model):
    class Period(models.TextChoices):
        HOUR = "hour", "小时"
        DAY = "day", "天"
        WEEK = "week", "周"
        MONTH = "month", "月"
        YEAR = "year", "年"

    product = models.ForeignKey(
        "catalog.Product", related_name="pricing_rules", on_delete=models.CASCADE
    )
    period = models.CharField(max_length=8, choices=Period.choices)
    base_amount = models.DecimalField(max_digits=10, decimal_places=2)
    tiers = models.JSONField(default=list, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        unique_together = ("product", "period")
        verbose_name = "计价规则"
        verbose_name_plural = "计价规则"

    def __str__(self):
        return f"{self.product.name} / {self.get_period_display()} / {self.base_amount}"

    def unit_amount_for(self, units):
        best = self.base_amount
        for tier in sorted(self.tiers or [], key=lambda t: t["min_units"]):
            if units >= tier["min_units"]:
                best = Decimal(str(tier["unit_amount"]))
        return best
```

- [ ] **Step 4: 实现服务**

`pricing/services.py`:

```python
from pricing.models import PricingRule


def quote(product, period, units):
    if units <= 0:
        raise ValueError("units must be positive")
    rule = product.pricing_rules.filter(period=period, is_active=True).first()
    if rule is None:
        raise ValueError(f"no active pricing rule for period={period}")
    return rule.unit_amount_for(units) * units
```

- [ ] **Step 5: 迁移与测试**

Run:
```bash
python manage.py makemigrations pricing && pytest pricing/tests/test_pricing.py -v
```
Expected: `3 passed`。

- [ ] **Step 6: Admin 内联计价规则到商品**

`pricing/admin.py`:

```python
from django.contrib import admin

from catalog.admin import ProductAdmin
from .models import PricingRule


class PricingRuleInline(admin.TabularInline):
    model = PricingRule
    extra = 1
    fields = ("period", "base_amount", "tiers", "is_active")


ProductAdmin.inlines = list(getattr(ProductAdmin, "inlines", [])) + [PricingRuleInline]


@admin.register(PricingRule)
class PricingRuleAdmin(admin.ModelAdmin):
    list_display = ("product", "period", "base_amount", "is_active")
    list_filter = ("period", "is_active")
    search_fields = ("product__name",)
    autocomplete_fields = ("product",)
```

- [ ] **Step 7: 提交**

```bash
git add rentalpf/pricing
git commit -m "feat(pricing): 可配置计价规则与报价服务"
```

---

## Task 7: 押金/免押规则与决策服务

**Files:**
- Modify: `rentalpf/pricing/models.py`
- Modify: `rentalpf/pricing/services.py`
- Modify: `rentalpf/pricing/admin.py`
- Create: `rentalpf/pricing/migrations/0002_*.py`（自动生成）
- Test: `rentalpf/pricing/tests/test_deposit.py`

**Interfaces:**
- Consumes: `Product`
- Produces:
  - `pricing.models.DepositRule(product, mode, amount, waiver_platform, waiver_limit, insurance_required, is_active)`
  - `DepositRule.Mode`（`authorization/full/waiver`）、`DepositRule.WaiverPlatform`（`none/zhima/wechat`）
  - `pricing.services.resolve_deposit(product, *, credit_limit=None) -> dict`，键：`mode`、`amount`、`platform`、`requires_insurance`、`note`
  - 反向关系：`Product.deposit_rule`（OneToOne）

- [ ] **Step 1: 写失败测试**

`pricing/tests/test_deposit.py`:

```python
from decimal import Decimal

import pytest

from catalog.models import Category, Product
from pricing.models import DepositRule
from pricing.services import resolve_deposit


def _product():
    cat = Category.objects.create(name="相机", slug="camera")
    return Product.objects.create(category=cat, name="相机 R5")


@pytest.mark.django_db
def test_authorization_primary():
    p = _product()
    DepositRule.objects.create(product=p, mode="authorization", amount=Decimal("8000.00"))
    result = resolve_deposit(p)
    assert result["mode"] == "authorization"
    assert result["amount"] == Decimal("8000.00")


@pytest.mark.django_db
def test_waiver_when_credit_enough():
    p = _product()
    DepositRule.objects.create(
        product=p, mode="waiver", amount=Decimal("8000.00"),
        waiver_platform="zhima", waiver_limit=Decimal("5000.00"),
    )
    result = resolve_deposit(p, credit_limit=Decimal("6000.00"))
    assert result["mode"] == "waiver"
    assert result["amount"] == Decimal("0")


@pytest.mark.django_db
def test_waiver_falls_back_to_authorization_when_credit_insufficient():
    p = _product()
    DepositRule.objects.create(
        product=p, mode="waiver", amount=Decimal("8000.00"),
        waiver_platform="zhima", waiver_limit=Decimal("5000.00"),
    )
    result = resolve_deposit(p, credit_limit=Decimal("1000.00"))
    assert result["mode"] == "authorization"
    assert result["amount"] == Decimal("8000.00")
    assert "fallback" in result["note"]


@pytest.mark.django_db
def test_no_rule_defaults_to_zero_authorization():
    p = _product()
    result = resolve_deposit(p)
    assert result["mode"] == "authorization"
    assert result["amount"] == Decimal("0")
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest pricing/tests/test_deposit.py -v`
Expected: FAIL（`ImportError: cannot import name 'DepositRule'`）。

- [ ] **Step 3: 追加模型**

在 `pricing/models.py` 末尾追加：

```python
class DepositRule(models.Model):
    class Mode(models.TextChoices):
        AUTHORIZATION = "authorization", "押金授权"
        FULL = "full", "全额押金"
        WAIVER = "waiver", "信用免押"

    class WaiverPlatform(models.TextChoices):
        NONE = "none", "无"
        ZHIMA = "zhima", "芝麻信用"
        WECHAT = "wechat", "微信支付分"

    product = models.OneToOneField(
        "catalog.Product", related_name="deposit_rule", on_delete=models.CASCADE
    )
    mode = models.CharField(max_length=15, choices=Mode.choices, default=Mode.AUTHORIZATION)
    amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    waiver_platform = models.CharField(
        max_length=8, choices=WaiverPlatform.choices, default=WaiverPlatform.NONE
    )
    waiver_limit = models.DecimalField(max_digits=10, decimal_places=2, null=True, blank=True)
    insurance_required = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        verbose_name = "押金规则"
        verbose_name_plural = "押金规则"

    def __str__(self):
        return f"{self.product.name} / {self.get_mode_display()} / {self.amount}"
```

- [ ] **Step 4: 追加服务**

在 `pricing/services.py` 末尾追加：

```python
from decimal import Decimal


def resolve_deposit(product, *, credit_limit=None):
    rule = getattr(product, "deposit_rule", None)
    if rule is None or not rule.is_active:
        return {
            "mode": "authorization",
            "amount": Decimal("0"),
            "platform": "none",
            "requires_insurance": False,
            "note": "no active deposit rule",
        }

    base = {
        "amount": rule.amount,
        "platform": rule.waiver_platform,
        "requires_insurance": rule.insurance_required,
    }

    can_waive = (
        rule.mode == rule.Mode.WAIVER
        and rule.waiver_limit is not None
        and credit_limit is not None
        and credit_limit >= rule.waiver_limit
    )
    if can_waive:
        return {"mode": "waiver", "amount": Decimal("0"), "note": "credit sufficient", **base}
    if rule.mode == rule.Mode.WAIVER:
        return {"mode": "authorization", "note": "credit insufficient, fallback", **base}
    return {"mode": rule.mode, "note": "", **base}
```

> 注意：`rule.mode == rule.Mode.WAIVER` 比较 char 与 TextChoices 值成立（Django TextChoices 是 str 子类）。

- [ ] **Step 5: 迁移与测试**

Run:
```bash
python manage.py makemigrations pricing && pytest pricing/tests/test_deposit.py -v
```
Expected: `4 passed`。

- [ ] **Step 6: Admin 内联押金规则到商品**

在 `pricing/admin.py` 追加：

```python
from .models import DepositRule


class DepositRuleInline(admin.StackedInline):
    model = DepositRule
    extra = 0
    max_num = 1
    fields = ("mode", "amount", "waiver_platform", "waiver_limit", "insurance_required", "is_active")


ProductAdmin.inlines = list(getattr(ProductAdmin, "inlines", [])) + [DepositRuleInline]


@admin.register(DepositRule)
class DepositRuleAdmin(admin.ModelAdmin):
    list_display = ("product", "mode", "amount", "waiver_platform", "waiver_limit", "is_active")
    list_filter = ("mode", "waiver_platform", "is_active")
    search_fields = ("product__name",)
    autocomplete_fields = ("product",)
```

- [ ] **Step 7: 提交**

```bash
git add rentalpf/pricing
git commit -m "feat(pricing): 押金授权为主/免押兜底的可配置规则与决策服务"
```

---

## Task 8: 小程序只读 API（分类 / 属性 / 商品）

**Files:**
- Create: `rentalpf/catalog/serializers.py`
- Create: `rentalpf/catalog/views.py`
- Modify: `rentalpf/catalog/urls.py`
- Test: `rentalpf/catalog/tests/test_api.py`

**Interfaces:**
- Consumes: `Category`、`AttributeDefinition`、`Product`、`AssetInstance`、`PricingRule`、`DepositRule`、`pricing.services`
- Produces（HTTP）:
  - `GET /api/categories/` → 顶层分类树（含 `children` 递归）
  - `GET /api/categories/<id>/attributes/` → 该分类适用属性列表
  - `GET /api/products/?category=<id>` → 商品列表（含 `price_from`）
  - `GET /api/products/<id>/` → 商品详情（含 `specs`、`images`、`pricing_rules`、`deposit_rule`）

- [ ] **Step 1: 写失败测试**

`catalog/tests/test_api.py`:

```python
from decimal import Decimal

import pytest
from rest_framework.test import APIClient

from catalog.models import AttributeDefinition, Category, Product
from inventory.models import AssetInstance
from pricing.models import DepositRule, PricingRule


@pytest.mark.django_db
def test_category_tree_endpoint():
    root = Category.objects.create(name="相机", slug="camera")
    Category.objects.create(name="镜头", slug="lens", parent=root)
    resp = APIClient().get("/api/categories/")
    assert resp.status_code == 200
    data = resp.json()
    camera = next(c for c in data if c["slug"] == "camera")
    assert camera["children"][0]["slug"] == "lens"


@pytest.mark.django_db
def test_category_attributes_endpoint():
    root = Category.objects.create(name="相机", slug="camera")
    AttributeDefinition.objects.create(category=root, key="brand", name="品牌")
    resp = APIClient().get(f"/api/categories/{root.id}/attributes/")
    assert resp.status_code == 200
    assert resp.json()[0]["key"] == "brand"


@pytest.mark.django_db
def test_product_list_with_price_from():
    cat = Category.objects.create(name="投影仪", slug="projector")
    p = Product.objects.create(category=cat, name="投影仪 X1", status=Product.Status.ACTIVE)
    AssetInstance.objects.create(product=p, sn="SN-1")
    PricingRule.objects.create(product=p, period="day", base_amount=Decimal("100.00"))

    resp = APIClient().get(f"/api/products/?category={cat.id}")
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert results[0]["name"] == "投影仪 X1"
    assert results[0]["price_from"] == "100.00"


@pytest.mark.django_db
def test_product_detail_includes_rules():
    cat = Category.objects.create(name="相机", slug="camera")
    p = Product.objects.create(category=cat, name="相机 R5", status=Product.Status.ACTIVE)
    PricingRule.objects.create(product=p, period="day", base_amount=Decimal("200.00"))
    DepositRule.objects.create(product=p, mode="authorization", amount=Decimal("8000.00"))

    resp = APIClient().get(f"/api/products/{p.id}/")
    assert resp.status_code == 200
    body = resp.json()
    assert body["pricing_rules"][0]["period"] == "day"
    assert body["deposit_rule"]["amount"] == "8000.00"
```

- [ ] **Step 2: 运行确认失败**

Run: `pytest catalog/tests/test_api.py -v`
Expected: FAIL（404 / 路由不存在）。

- [ ] **Step 3: 实现序列化器**

`catalog/serializers.py`:

```python
from rest_framework import serializers

from .models import AttributeDefinition, Category, Product


class AttributeDefinitionSerializer(serializers.ModelSerializer):
    class Meta:
        model = AttributeDefinition
        fields = ["id", "key", "name", "data_type", "required", "options", "unit"]


class CategorySerializer(serializers.ModelSerializer):
    children = serializers.SerializerMethodField()

    class Meta:
        model = Category
        fields = ["id", "name", "slug", "sort_order", "children"]

    def get_children(self, obj):
        qs = obj.children.filter(is_active=True)
        return CategorySerializer(qs, many=True).data


class PricingRuleSerializer(serializers.ModelSerializer):
    class Meta:
        from pricing.models import PricingRule
        model = PricingRule
        fields = ["period", "base_amount", "tiers"]


class DepositRuleSerializer(serializers.ModelSerializer):
    class Meta:
        from pricing.models import DepositRule
        model = DepositRule
        fields = ["mode", "amount", "waiver_platform", "waiver_limit", "insurance_required"]


class ProductListSerializer(serializers.ModelSerializer):
    price_from = serializers.SerializerMethodField()

    class Meta:
        model = Product
        fields = ["id", "name", "brand", "model", "images", "status", "price_from"]

    def get_price_from(self, obj):
        rule = obj.pricing_rules.filter(is_active=True).order_by("base_amount").first()
        return str(rule.base_amount) if rule else None


class ProductDetailSerializer(serializers.ModelSerializer):
    pricing_rules = PricingRuleSerializer(many=True, read_only=True)
    deposit_rule = DepositRuleSerializer(read_only=True)

    class Meta:
        model = Product
        fields = [
            "id", "name", "brand", "model", "sku_code", "description",
            "images", "specs", "status", "pricing_rules", "deposit_rule",
        ]
```

- [ ] **Step 4: 实现视图**

`catalog/views.py`:

```python
from rest_framework import mixins, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from .models import Category, Product
from .serializers import (
    AttributeDefinitionSerializer,
    CategorySerializer,
    ProductDetailSerializer,
    ProductListSerializer,
)


class CategoryViewSet(mixins.ListModelMixin, viewsets.GenericViewSet):
    serializer_class = CategorySerializer
    queryset = Category.objects.filter(parent__isnull=True, is_active=True)

    @action(detail=True, methods=["get"])
    def attributes(self, request, pk=None):
        category = self.get_object()
        data = AttributeDefinitionSerializer(category.applicable_attributes(), many=True).data
        return Response(data)


class ProductViewSet(mixins.ListModelMixin, mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    queryset = Product.objects.filter(status=Product.Status.ACTIVE).prefetch_related("pricing_rules")

    def get_serializer_class(self):
        return ProductDetailSerializer if self.action == "retrieve" else ProductListSerializer

    def get_queryset(self):
        qs = super().get_queryset()
        category = self.request.query_params.get("category")
        if category:
            qs = qs.filter(category_id=category)
        return qs
```

- [ ] **Step 5: 路由**

`catalog/urls.py`:

```python
from rest_framework.routers import DefaultRouter

from .views import CategoryViewSet, ProductViewSet

router = DefaultRouter()
router.register("categories", CategoryViewSet, basename="category")
router.register("products", ProductViewSet, basename="product")

urlpatterns = router.urls
```

- [ ] **Step 6: 测试**

Run: `pytest catalog/tests/test_api.py -v`
Expected: `4 passed`。

- [ ] **Step 7: 全量测试并提交**

Run: `pytest`
Expected: 全部通过（≥ 16 passed）。

```bash
git add rentalpf
git commit -m "feat(api): 小程序只读接口（分类/属性/商品）"
```

---

## Self-Review（作者自检记录）

- **Spec 覆盖**：覆盖 REQ-CAT-01~06（分类树/一机一码/属性模板/档期基础字段/上架数据驱动）、REQ-PRICE-01~04（计价周期/计费模式）、REQ-PAY-02（押金授权为主+免押兜底+后台可配）、REQ-NFR-06/07（可配置红线与技术栈）。档期锁定、下单、支付、交付、通知属后续计划。
- **占位扫描**：无 TBD/TODO；每个代码步骤均含完整代码。`catalog/urls.py` 在 Task 1 有意留空、Task 8 填充，已显式说明。
- **类型一致性**：`quote(product, period, units)`、`resolve_deposit(product, *, credit_limit)`、`Category.applicable_attributes()`、`Product.assets`、`Product.pricing_rules`、`Product.deposit_rule` 在测试与实现中命名一致。返回 dict 的键 `mode/amount/platform/requires_insurance/note` 在 Task 7 各测试中一致。
