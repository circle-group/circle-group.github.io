---
title: Team
nav:
  order: 3
  tooltip: About our team
---

# {% include icon.html icon="fa-solid fa-users" %}Team

We have multliple <u><a href="https://tolgabirdal.github.io/assets/pdf/circlejobs_phd.pdf">PhD</a></u> and <u><a href="https://tolgabirdal.github.io/assets/pdf/circlejobs.pdf">PostDoc</a></u> positions available. Feel free to e-mail me your CV and ideas. Below are the members of the CIRCLE group.

{% include section.html %}

<!--{% include list.html data="members" component="portrait" filter="role == 'pi'" %}-->
{% include list.html data="members" component="portrait" filter="role == 'principal-investigator'" %}
{% include list.html data="members" component="portrait" filter="role == 'postdoc'" %}
{% include list.html data="members" component="portrait" filter="role == 'phd'" %}

{% include section.html background="images/background.jpg" dark=true %}

We are fortunate to oftenly receive visitors and collaborate with various researchers:

{% include list.html data="members" component="portrait" filter="role == 'visitor'" %}

{% include section.html %}

{% capture content %}

{% capture col1 %}
{%
%}
{% endcapture %}

{% capture col2 %}
{%
  include figure.html
  image="images/team.jpeg"
  caption="Team dinner"
%}
{% endcapture %}

{% capture col3 %}
{%
%}
{% endcapture %}

<!--{% include figure.html image="images/team.jpeg" %}-->
{% include cols.html col1=col1 col2=col2 col3=col3%}

{% endcapture %}

{% include grid.html style="square" content=content %}
