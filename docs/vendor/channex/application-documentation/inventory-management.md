> For the complete documentation index, see [llms.txt](https://docs.channex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.channex.io/application-documentation/inventory-management.md).

# Inventory Management

**Table of Content:**

1. Select Property
2. PMS connected Properties
3. Inventory Management Overview
4. How to Navigate the Inventory Grid
5. Inventory Shortcodes
6. Update the table
7. Bulk Update
8. Change Log

### **1. Select Which Property to View**

You are able to view a single or multi property at this page, to choose your view use the property selector at the top of the page

![Select a single property or group](/files/-LeRiZJQBnWcQMEZCo94)

{% hint style="info" %}
Generally for hotels and multi unit accommodation businesses you will want to view one property at a time. For vacation rental you will be able to benefit for single or group views.
{% endhint %}

### 2. PMS Connected Properties

For properties that have a PMS connected.

The PMS will update to availability, rates and restrictions, changing anything here manually may mean that it is later overwritten by a PMS update.

There are some advanced settings which is likely the PMS does not update:

* Max Availability
* Availability Offset

```
You can use these special settings to control availability. 
Please go here for more details
```

### 3. Inventory Management Overview

We use the standard hierarchy of:

* Room Types
* Room Rates
* Channel Rates

#### **Room Type**

This is the type of room you are selling

**Example:** Double Room, Family Room

{% hint style="info" %}
Room Types are from the Hotel industry to manage multiple rooms of the same type (Multi Unit)

If you are a vacation rental or sell rooms individually then just call the room type after your property or room.
{% endhint %}

#### Room Rate / Rate Plan

A room rate is a combo of the Room Type and Rate Plan

**Example:** Double / Best Available Rate

{% hint style="info" %}
The Room Rate will hold all details of Pricing, Availability and Restrictions for that Room Type.
{% endhint %}

#### Channel Rate

A channel rate is when a room rate is mapped to a channel, you will be able to see here what is sent to that channel.

{% hint style="info" %}
Channel Rate is what is sent to the channel, in channel mapping you can use a modifier to change rates sent to channels.

Example: +10%

In this example the channel rate should show 10% higher than the parent rate.
{% endhint %}

### 4. How to Navigate the Inventory Grid

![Key parts of inventory management table](/files/-LeS7jMTbY5clY4wACvw)

Navigation - You can navigate in 2 ways:

1. Use the date picker and select a date
2. Use the arrows to go to next date range.

### 5. Inventory Shortcodes:

We have lots of shortcodes on the calendar:

Common:

* RATE - This is the Rate/Price
* MSA - Minimum Stay Arrival
* AVL - Availability (How many rooms/units left)
* SS - Stop Sell Restriction
* MXS - Maximum Stay Restriction
* CTA - Closed to Arrival
* CTD - Closed to Departure

Special Ones:

* AVO - Availability Offset
* MAL - Maximum Availability
* AVL - Availability of room rate

### Update the Table

To change anything on the grid you just need to click on it or click and drag for a date range

![Changing a rate for 3 days](/files/-LeSPXwHyOObvWzRT4U1)

After you click on the grid you will see a popup like this:

![After you click on inventory grid](/files/-LeSPmVu0Xs3AwPaX7YR)

Now you can check the dates are correct and enter the new value.

Once you have updated the grid you can save or reset changes.

### Bulk Update

This is the method you need for bulk changes, you can do multiple date ranges and days of the week

![Bulk Update Screen](/files/-LeSQhqCi3g7GBdWtSOb)

Affected Dates: You can update with 1 date range or add multiple

Restrictions: Here you can choose what you want to update, you can update multiple things at the same time.

Affected Rooms: You can search the table for any text, the table will show only what matches the search.

Select the rooms and rates you wish to update

Press save to finish!

![Example of a bulk update](/files/-LeSRoDIzbHbcD6QBcbO)

## Change Log

We made another page for change log, please see here: [Change Log](/application-documentation/change-log-feature.md)
