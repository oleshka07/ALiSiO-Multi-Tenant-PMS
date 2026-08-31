> For the complete documentation index, see [llms.txt](https://docs.channex.io/llms.txt). Markdown versions of documentation pages are available by appending `.md` to page URLs; this page is available as [Markdown](https://docs.channex.io/application-documentation/properties-and-groups-management.md).

# Properties and Groups Management

### Add a new property

If you are starting a new account you will have no properties listed, please click on the **Create** button to make your property.

![Add a new property](/files/hwXZ6rN7hvDIgU0aHJUT)

Please enter all details and click save

{% hint style="info" %}
All properties will be a member of a group, even if you choose another group you have created. A property can be a member of multiple groups.
{% endhint %}

**Property Type**

Selecting what kind of property will determine its billing type also

| Name          | Group           |
| ------------- | --------------- |
| Camping       | Hotel           |
| Holiday Park  | Hotel           |
| Tent          | Hotel           |
| Guest House   | Hotel           |
| Resort        | Hotel           |
| Hostel        | Hotel           |
| Hotel         | Hotel           |
| Inn           | Hotel           |
| Lodge         | Hotel           |
| Motel         | Hotel           |
| ApartHotel    | Hotel           |
| Riad          | Hotel           |
| Ryokan        | Hotel           |
| Capsule Hotel | Hotel           |
| Apartment     | Vacation Rental |
| Holiday Home  | Vacation Rental |
| Chalet        | Vacation Rental |
| Boat          | Vacation Rental |
| Farm stay     | Vacation Rental |
| Homestay      | Vacation Rental |
| Villa         | Vacation Rental |
| Country house | Vacation Rental |

### Property Settings

<figure><img src="/files/6pKiebH4r7zTIcsa6hqj" alt=""><figcaption></figcaption></figure>

Min Price: If you set this you cannot set a price lower than this amount

Max Price: If you set this you cannot set a price higher than this amount

<figure><img src="/files/8SRJbiWW3tTQpkXtzE5L" alt=""><figcaption></figcaption></figure>

Automatic availability settings - This is what happens when a booking arrives in Channex, should Channex increase or decrease availability automatically or not

New Booking - When a new booking comes should Channex reduce availability (Recommended ON)

Modified Booking - When a modified booking comes should Channex change availability

Cancelled Booking - When a cancellation comes should Channex increase availability

### Inventory Days

<figure><img src="/files/y1S8XZpS4z2JpxgHppOd" alt=""><figcaption></figcaption></figure>

This setting controls how many days your inventory will hold. Default is 500 but we can go up to 730 days.

### Min Stay Settings

<figure><img src="/files/M5SFPpAzYUQSmkNjQfHO" alt=""><figcaption></figcaption></figure>

This setting will simplify the user experience when you connect a OTA channel. Right now most OTA only support 1 Min stay and you select which one you send. If you set here at the property level then it removes this choice and makes less setting problems and bookings for less nights than expected.

### Cut Off Time

<figure><img src="/files/mEVr3BtUDRcl1rakkgUb" alt=""><figcaption></figcaption></figure>

You can set a time to stop bookings being made for the current night. This is useful for small properties where they don't want last minute bookings in the evening. Once this time hits we change availability to 0 and it cannot be changed unless you turn off the setting.

{% hint style="warning" %}
We change date at 2am property time each night. So if you set at 00 it will stop bookings between Midnight and 2am. If you want to set a 24 hours cut off better to set at 11:30 and 2 days.
{% endhint %}

### Add New Group

To add a new group please click the Create button and choose to add a group

![Adding a new group](/files/-LeWe8hpXfsrYOjTdf4X)

A group is a simple field to ask for a name.

The purpose of a group is to collect a number of properties together for viewing or reporting purposes.

{% hint style="info" %}
A property can be a member of multiple groups
{% endhint %}

###

### Assign a property to a group

![assign a property to a group](/files/-LeX4jDR6QwRE9vcmUjr)

Click on actions button on the group and assign property. Then select a property from the list to add.

### Remove a Property from a group

![Remove property from a group](/files/-LeX52w03ybA_5QryWtB)

{% hint style="warning" %}
If the property is only a member of one group, the remove options will be disabled. This is because every property must be a member of at least 1 group.
{% endhint %}
